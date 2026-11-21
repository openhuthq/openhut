import { createHash, randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import { KeyBox, MemberList, signProof, type Cloud, type CloudAuthorization, type RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { toBase64 } from '@openhut/common/vault/vault.ts'
import { cloud } from '../platform/cloud.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { callbackBase } from '../connections/connection-service.ts'
import { keysService, type Account } from './keys-service.ts'
import { syncService } from './sync-service.ts'

const PENDING_MS = 15 * 60_000
const RETURN = /^(app:\/\/openhut|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?)$/
const Workspaces = z.object({ data: z.array(z.object({ id: z.string(), key: z.string() })) })
const Lists = z.object({ data: z.array(MemberList) })
const pending = new Map<string, { verifier: string; authorization: string; returnTo: string; at: number }>()

export const cloudService = {
  async status(): Promise<Cloud> {
    const account = keysService.account()
    const session = keysService.session()
    const on = Boolean(account && session)
    const members = keysService.members()
    const locked = session && !account ? keysService.locked() : undefined
    return {
      object: 'cloud', status: locked ? 'locked' : on ? (syncService.ready() ? 'on' : 'offline') : 'off', email: locked?.email ?? (on && account ? account.email : null),
      device: toBase64((await keysService.device()).publicKey),
      workspace: on && account && members ? { id: account.workspace.id, version: members.version, members: members.members } : null,
      keyStore: keysService.keyStore(), kit: on ? keysService.kit() : null, backup: syncService.status(),
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
      await keysService.setSession({ token: session.token, expiresAt: session.expiresAt })
      if (keysService.account()?.sub !== session.sub) {
        const kit = await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token: session.token })
        if (kit.status === 200) {
          await keysService.setLocked({ sub: session.sub, email: session.email })
          return `${started.returnTo}/`
        }
        await syncService.reset({ restoring: false })
      }
      const account = await keysService.open({ sub: session.sub, email: session.email })
      await openRoom({ account, token: session.token })
      syncService.connect()
      return keysService.kit() ? back : `${back}?open=kit`
    } catch (err) {
      return `${back}?error=${encodeURIComponent(messageOf(err))}`
    }
  },

  async signOut(): Promise<Cloud> {
    await keysService.setSession(undefined)
    await keysService.setLocked(undefined)
    syncService.disconnect()
    return cloudService.status()
  },

  async newKit(): Promise<RecoveryKit> {
    if (!keysService.session()) throw new HttpError(409, 'Turn on OpenHut Cloud before making a recovery kit.')
    return keysService.newKit()
  },

  async confirmKit({ words }: { words: string[] }): Promise<Cloud> {
    if (!await keysService.confirmKit(words)) throw new HttpError(400, 'Those words don’t match your kit. Check the numbers and try again.', { param: 'words' })
    const saved = await cloud.account({ method: 'PUT', path: '/v1/key-boxes/kit', token: await keysService.token(), body: { body: keysService.kitBox() } })
    if (saved.status !== 200) throw new HttpError(502, `OpenHut Cloud didn’t keep your kit (HTTP ${saved.status}). Try again.`)
    return cloudService.status()
  },

  async unlock({ words }: { words: string[] }): Promise<Cloud> {
    const locked = keysService.locked()
    if (!locked) throw new HttpError(409, 'This computer isn’t waiting to unlock. Sign in to OpenHut Cloud first.')
    const token = await keysService.token()
    const kit = KeyBox.safeParse((await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token })).json).data
    const workspace = Workspaces.safeParse((await cloud.account({ method: 'GET', path: '/v1/workspaces', token })).json).data?.data[0]
    const chain = workspace && Lists.safeParse((await cloud.room({ method: 'GET', workspace: workspace.id, path: '/member-lists?after=0', token })).json).data?.data
    if (!kit || !workspace || !chain) throw new HttpError(502, 'OpenHut Cloud has no backup to restore for this account.')
    const account = await keysService.restore({ words, kit: kit.body, workspace, chain })
    if (!account) throw new HttpError(400, 'Those aren’t the words of your recovery kit. Check each word and try again.', { param: 'words' })
    const joined = await cloud.room({ method: 'PUT', workspace: workspace.id, path: '/members', token, body: account.list })
    if (joined.status !== 200) throw new HttpError(502, `OpenHut Cloud didn’t add this computer (HTTP ${joined.status}). Try again.`)
    await syncService.reset({ restoring: true })
    await keysService.adopt(account)
    syncService.connect()
    return cloudService.status()
  },

  connect: syncService.connect,
}

async function openRoom({ account, token }: { account: Account; token: string }): Promise<void> {
  const workspace = account.workspace.id
  await cloud.account({ method: 'POST', path: '/v1/workspaces', token, body: await keysService.workspaceBox(account) })
  const found = await cloud.room({ method: 'GET', workspace, path: '/members', token })
  if (found.status === 200) return
  const made = found.status === 404 ? await cloud.room({ method: 'PUT', workspace, path: '/members', token, body: account.list }) : found
  if (made.status !== 200) throw new HttpError(502, `OpenHut Cloud refused this workspace (HTTP ${made.status}).`)
}
