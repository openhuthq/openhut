import { createHash, randomBytes } from 'node:crypto'
import ReconnectingWebSocket from 'partysocket/ws'
import * as z from 'zod/mini'
import { MemberListBody, parseJson, signProof, type Cloud, type CloudAuthorization, type RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { fromBase64, toBase64 } from '@openhut/common/vault/vault.ts'
import { cloud } from '../platform/cloud.ts'
import { log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { callbackBase } from '../connections/connection-service.ts'
import { keysService, type Account } from './keys-service.ts'

const PENDING_MS = 15 * 60_000
const REFRESH_EARLY_MS = 5 * 60_000
const RETURN = /^(app:\/\/openhut|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/
const Ready = z.object({ type: z.literal('ready'), version: z.number() })
const pending = new Map<string, { verifier: string; authorization: string; returnTo: string; at: number }>()
let socket: ReconnectingWebSocket | undefined
let ready = false

export const cloudService = {
  async status(): Promise<Cloud> {
    const account = keysService.account()
    const session = keysService.session()
    const on = Boolean(account && session)
    const members = account ? MemberListBody.safeParse(parseJson(new TextDecoder().decode(fromBase64(account.list.bytes)))).data : undefined
    return {
      object: 'cloud', status: on ? (ready ? 'on' : 'offline') : 'off', email: on && account ? account.email : null,
      device: toBase64((await keysService.device()).publicKey),
      workspace: on && account && members ? { id: account.workspace.id, version: members.version, members: members.members } : null,
      keyStore: keysService.keyStore(), kit: on ? keysService.kit() : null,
    }
  },

  async start({ returnTo }: { returnTo?: string }): Promise<CloudAuthorization> {
    const device = await keysService.device()
    const state = randomBytes(24).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url')
    const { id, authorizationUrl } = await cloud.authorization({
      provider: 'google', scopes: ['openid', 'email'], codeChallenge, redirectUrl: `${callbackBase()}/api/cloud/callback`, state, deviceKey: toBase64(device.publicKey),
    })
    for (const [key, value] of pending) if (Date.now() - value.at > PENDING_MS) pending.delete(key)
    pending.set(state, { verifier, authorization: id, returnTo: returnTo && RETURN.test(returnTo) ? returnTo : '', at: Date.now() })
    return { object: 'cloud_authorization', authorizationUrl }
  },

  async finish({ state, code, error }: { state?: string; code?: string; error?: string }): Promise<string> {
    const started = pending.get(state ?? '')
    pending.delete(state ?? '')
    const back = `${started?.returnTo ?? ''}/settings/cloud`
    if (!started || !code) return `${back}?error=${encodeURIComponent(error ? 'Sign-in was cancelled.' : 'This sign-in expired. Try again.')}`
    try {
      const device = await keysService.device()
      const signature = await signProof({ signer: device, proof: 'session', parts: [started.authorization, code] })
      const session = await cloud.session({ grantType: 'authorization_code', authorization: started.authorization, code, codeVerifier: started.verifier, deviceKey: toBase64(device.publicKey), signature })
      const account = await keysService.open({ sub: session.sub, email: session.email })
      await keysService.setSession({ token: session.token, expiresAt: session.expiresAt })
      await openRoom({ account, token: session.token })
      connect()
      return keysService.kit() ? back : `${back}?open=kit`
    } catch (err) {
      return `${back}?error=${encodeURIComponent(messageOf(err))}`
    }
  },

  async signOut(): Promise<Cloud> {
    await keysService.setSession(undefined)
    socket?.close()
    socket = undefined
    ready = false
    return cloudService.status()
  },

  async newKit(): Promise<RecoveryKit> {
    if (!keysService.session()) throw new HttpError(409, 'Turn on OpenHut Cloud before making a recovery kit.')
    return keysService.newKit()
  },

  async confirmKit({ words }: { words: string[] }): Promise<Cloud> {
    if (!await keysService.confirmKit(words)) throw new HttpError(400, 'Those words don’t match your kit. Check the numbers and try again.', { param: 'words' })
    return cloudService.status()
  },

  connect,
}

async function openRoom({ account, token }: { account: Account; token: string }): Promise<void> {
  const workspace = account.workspace.id
  const found = await cloud.room({ method: 'GET', workspace, path: '/members', token })
  if (found.status === 200) return
  const made = found.status === 404 ? await cloud.room({ method: 'PUT', workspace, path: '/members', token, body: account.list }) : found
  if (made.status !== 200) throw new HttpError(502, `OpenHut Cloud refused this workspace (HTTP ${made.status}).`)
}

function connect(): void {
  const account = keysService.account()
  if (socket || !account || !keysService.session()) return
  socket = new ReconnectingWebSocket(cloud.roomUrl(account.workspace.id), [], { WebSocket: globalThis.WebSocket })
  socket.addEventListener('open', () => {
    fresh().then((token) => socket?.send(JSON.stringify({ type: 'hello', token })), (err: unknown) => log.warn({ event: 'cloud.refresh_failed', error: messageOf(err) }))
  })
  socket.addEventListener('message', (event) => { if (Ready.safeParse(parseJson(String(event.data))).success) ready = true })
  socket.addEventListener('close', () => { ready = false })
}

async function fresh(): Promise<string> {
  const session = keysService.session()
  if (!session) throw new HttpError(409, 'Signed out.')
  if (Date.parse(session.expiresAt) - Date.now() > REFRESH_EARLY_MS) return session.token
  const signedAt = Date.now()
  const signature = await signProof({ signer: await keysService.device(), proof: 'refresh', parts: [session.token, String(signedAt)] })
  const next = await cloud.session({ grantType: 'refresh', session: session.token, signedAt, signature })
  await keysService.setSession({ token: next.token, expiresAt: next.expiresAt })
  return next.token
}
