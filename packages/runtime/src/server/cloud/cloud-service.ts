import { createHash, randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import { KeyBox, MemberList, signProof, type Cloud, type CloudAuthorization, type RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import { toBase64 } from '@openhut/common/vault/vault.ts'
import { cloud } from '../platform/cloud.ts'
import { log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { callbackBase } from '../connections/connection-service.ts'
import { keysService, type Account } from './keys-service.ts'
import { syncService } from './sync-service.ts'

const PENDING_MS = 15 * 60_000
const HERE = process.platform === 'darwin' ? 'Mac' : 'computer'
const SIGNED_IN = 'You’re signed in. You can go back to OpenHut.'
const Workspaces = z.object({ data: z.array(z.object({ id: z.string(), key: z.string(), by: z.optional(z.string()), signature: z.optional(z.string()) })) })
const Lists = z.object({ data: z.array(MemberList) })
const pending = new Map<string, { verifier: string; authorization: string; at: number }>()
let signInError: string | null = null
let boxesDiffer = false

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
      keyStore: keysService.keyStore(), kit: on ? kitOf() : null, backup: syncService.status(),
      signInError, keptAccount: on ? null : keysService.keptAccount(),
    }
  },

  async start(): Promise<CloudAuthorization> {
    const device = await keysService.device()
    const state = randomBytes(24).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(verifier).digest('base64url')
    const { id, authorizationUrl } = await cloud.authorization({
      provider: 'google', scopes: ['openid', 'email'], codeChallenge, redirectUrl: `${callbackBase()}/api/cloud/callback`, state, deviceKey: toBase64(device.publicKey),
    })
    for (const [key, value] of pending) if (Date.now() - value.at > PENDING_MS) pending.delete(key)
    pending.set(state, { verifier, authorization: id, at: Date.now() })
    signInError = null
    return { object: 'cloud_authorization', authorizationUrl }
  },

  async finish({ state, code, error }: { state?: string; code?: string; error?: string }): Promise<string> {
    const started = pending.get(state ?? '')
    pending.delete(state ?? '')
    if (!started) return page('This sign-in expired. Go back to OpenHut and try again.')
    if (!code) {
      signInError = error ? 'Sign-in was cancelled.' : 'Google didn’t finish the sign-in. Try again.'
      return page(`${signInError} You can go back to OpenHut.`)
    }
    try {
      const device = await keysService.device()
      const signature = await signProof({ signer: device, proof: 'session', parts: [started.authorization, code] })
      const session = await cloud.session({ grantType: 'authorization_code', authorization: started.authorization, code, codeVerifier: started.verifier, deviceKey: toBase64(device.publicKey), signature })
      keysService.ownedBy(session)
      await keysService.setSession({ token: session.token, expiresAt: session.expiresAt })
      const who = { sub: session.sub, email: session.email }
      if (keysService.account()?.sub !== session.sub) {
        if (await accountExists(session.token)) {
          await keysService.setLocked(who)
          return page(SIGNED_IN)
        }
        await syncService.reset({ restoring: false })
      }
      const account = await keysService.open(who)
      if (!await openRoom({ account, token: session.token })) {
        await keysService.relock(who)
        return page(SIGNED_IN)
      }
      cloudService.connect()
      return page(SIGNED_IN)
    } catch (err) {
      signInError = messageOf(err)
      return page(`${signInError} Go back to OpenHut.`)
    }
  },

  async forget(): Promise<Cloud> {
    await keysService.forget()
    signInError = null
    return cloudService.status()
  },

  async signOut(): Promise<Cloud> {
    await keysService.setSession(undefined)
    await keysService.setLocked(undefined)
    syncService.disconnect()
    return cloudService.status()
  },

  async newKit(): Promise<RecoveryKit> {
    const account = keysService.account()
    if (!keysService.session() || !account) throw new HttpError(409, 'Turn on OpenHut Cloud before making a recovery kit.')
    const { words, box, ask } = await keysService.newKit()
    await keysService.setKit(undefined)
    const saved = await cloud.account({ method: 'PUT', path: '/v1/key-boxes/kit', token: await keysService.token(), body: await keysService.signBox({ account, name: 'kit', body: box }) })
    if (saved.status !== 200) throw new HttpError(502, `OpenHut Cloud didn’t keep your kit (HTTP ${saved.status}). Try again.`)
    await keysService.saveKit(box)
    boxesDiffer = false
    return { object: 'recovery_kit', words, ask }
  },

  async unlock({ words }: { words: string[] }): Promise<Cloud> {
    const locked = keysService.locked()
    if (!locked) throw new HttpError(409, 'This computer isn’t waiting to unlock. Sign in to OpenHut Cloud first.')
    const token = await keysService.token()
    const kit = KeyBox.safeParse((await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token })).json).data
    if (!kit) throw new HttpError(409, `There’s no recovery kit for this account yet. Save one on the ${HERE} you signed in on first, then type its words here.`)
    const boxes = Workspaces.safeParse((await cloud.account({ method: 'GET', path: '/v1/workspaces', token })).json).data?.data ?? []
    const workspaces = await Promise.all(boxes.map(async (box) => ({ ...box, chain: Lists.safeParse((await cloud.room({ method: 'GET', workspace: box.id, path: '/member-lists?after=0', token })).json).data?.data ?? [] })))
    const account = await keysService.restore({ words, kit: kit.body, workspaces })
    if (!account) throw new HttpError(400, 'Those aren’t the words of your recovery kit. Check each word and try again.', { param: 'words' })
    const joined = await cloud.room({ method: 'PUT', workspace: account.workspace.id, path: '/members', token, body: account.list })
    if (joined.status !== 200) throw new HttpError(502, `OpenHut Cloud didn’t add this computer (HTTP ${joined.status}). Try again.`)
    await syncService.reset({ restoring: true })
    await keysService.adopt({ account, kit: { box: kit.body, savedAt: kit.savedAt ?? new Date().toISOString() } })
    cloudService.connect()
    return cloudService.status()
  },

  connect(): void {
    syncService.connect()
    if (keysService.account() && keysService.session()) checkBoxes().catch((err: unknown) => log.warn({ event: 'cloud.box_check_failed', error: messageOf(err) }))
  },
}

function kitOf(): { savedAt: string; differs: boolean } | null {
  const kit = keysService.kit()
  return kit || boxesDiffer ? { savedAt: kit?.savedAt ?? new Date(0).toISOString(), differs: boxesDiffer } : null
}

async function accountExists(token: string): Promise<boolean> {
  const workspaces = await cloud.account({ method: 'GET', path: '/v1/workspaces', token })
  const listed = Workspaces.safeParse(workspaces.json).data
  if (workspaces.status !== 200 || !listed) throw new HttpError(502, `OpenHut Cloud didn’t say whether this account has a backup (HTTP ${workspaces.status}).`)
  return listed.data.length > 0 || (await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token })).status === 200
}

async function checkBoxes(): Promise<void> {
  const account = keysService.account()
  if (!account) return
  const token = await keysService.token()
  const kit = await cloud.account({ method: 'GET', path: '/v1/key-boxes/kit', token })
  const workspaces = await cloud.account({ method: 'GET', path: '/v1/workspaces', token })
  if (![200, 404].includes(kit.status) || workspaces.status !== 200) return
  const cloudKit = KeyBox.safeParse(kit.json).data
  const mine = keysService.kitBox()
  const kitMine = cloudKit && await keysService.boxIsMine({ account, name: 'kit', box: cloudKit })
  if (cloudKit && mine && cloudKit.body !== mine) await keysService.setKit(undefined)
  const box = Workspaces.safeParse(workspaces.json).data?.data.find((each) => each.id === account.workspace.id)
  const boxMine = box && await keysService.boxIsMine({ account, name: `workspace/${account.workspace.id}`, box: { body: box.key, by: box.by, signature: box.signature } })
  const reboxed = boxMine || (await cloud.account({ method: 'POST', path: '/v1/workspaces', token, body: await keysService.workspaceBox(account) })).status === 200
  const kitOk = cloudKit ? kitMine : !mine || (await cloud.account({ method: 'PUT', path: '/v1/key-boxes/kit', token, body: await keysService.signBox({ account, name: 'kit', body: mine }) })).status === 200
  boxesDiffer = !reboxed || !kitOk
}

function page(sentence: string): string {
  const text = sentence.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OpenHut</title><body style="margin:0;display:grid;place-items:center;min-height:90vh;font:15px/1.5 -apple-system,system-ui,sans-serif;color:#0b0b0b;background:#fff"><p style="max-width:420px;padding:0 16px;text-align:center">${text}</p></body>`
}

async function openRoom({ account, token }: { account: Account; token: string }): Promise<boolean> {
  const workspace = account.workspace.id
  const boxed = await cloud.account({ method: 'POST', path: '/v1/workspaces', token, body: await keysService.workspaceBox(account) })
  if (boxed.status === 403) return false
  const found = await cloud.room({ method: 'GET', workspace, path: '/members', token })
  if (found.status === 200) return true
  const made = found.status === 404 ? await cloud.room({ method: 'PUT', workspace, path: '/members', token, body: account.list }) : found
  if (made.status !== 200) throw new HttpError(502, `OpenHut Cloud refused this workspace (HTTP ${made.status}).`)
  return true
}
