import { spawnSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { hostname } from 'node:os'
import { checkProof, MemberList, signProof, type CloudSession, type Letter } from '@openhut/common/cloud/cloud.ts'
import { anchorOf, check, keyVersionOf, signList, youngUntil } from '@openhut/common/cloud/member-list.ts'
import { equal, fromBase64, fromWords, identity, letter, lock, newKey, newWords, pairingWorkspace, read, slot, toBase64, unlock, type Bytes, type Identity, type LetterPurpose } from '@openhut/common/vault/vault.ts'
import { cloud } from '../platform/cloud.ts'
import { HttpError } from '../platform/http-error.ts'
import { keyStore, type Account, type Session, type Stored } from './key-store.ts'
import { bodyOf, nextOf, readSecret, roomKeys, secretOf } from './room-keys.ts'

const REFRESH_EARLY_MS = 5 * 60_000
const HERE = process.platform === 'darwin' ? 'Mac' : 'computer'
export type Sent = { to: string; purpose: LetterPurpose; body: string }
type Boxed = { id: string; key: string; chain: MemberList[] }
const { machine } = keyStore

export const keysService = {
  device: async (): Promise<Identity> => identity(fromBase64((await keyStore.read()).device)),

  deviceKey: async (): Promise<string> => toBase64((await keysService.device()).publicKey),

  async accountDeviceKey(): Promise<string | null> {
    const key = stored()?.account?.key
    return key ? toBase64((await accountDevice(fromBase64(key))).publicKey) : null
  },

  account: (): Account | undefined => stored()?.account,
  locked: (): { sub: string; email: string } | undefined => stored()?.locked,
  kitState: (): { saved: { box: string; savedAt: string } | null; pending: string | null } => ({ saved: kitOf(stored()) ?? null, pending: stored()?.kit?.confirmed === false ? stored()?.kit?.box ?? null : null }),

  setLocked: async (locked: { sub: string; email: string } | undefined): Promise<void> => keyStore.write({ ...await keyStore.read(), locked }),

  async token(): Promise<string> {
    const session = stored()?.session
    if (!session) throw new HttpError(409, 'Turn on OpenHut Cloud first.')
    if (Date.parse(session.expiresAt) - Date.now() > REFRESH_EARLY_MS) return session.token
    const signedAt = Date.now()
    const signature = await signProof({ signer: await keysService.device(), proof: 'refresh', parts: [session.token, String(signedAt)] })
    const account = stored()?.account
    const runtime = account && !account.key ? account.workspace.id : undefined
    const next = await cloud.session({ grantType: 'refresh', session: session.token, signedAt, signature }).catch((err: unknown) => {
      if (!runtime) throw err
      return keysService.deviceSession(runtime)
    })
    await keysService.setSession({ token: next.token, expiresAt: next.expiresAt })
    return next.token
  },

  async deviceSession(workspace: string): Promise<CloudSession> {
    const device = await keysService.device()
    const signedAt = Date.now()
    const signature = await signProof({ signer: device, proof: 'device', parts: [workspace, String(signedAt)] })
    return cloud.deviceSession({ workspace, device: toBase64(device.publicKey), signedAt, signature })
  },

  async addDevice(device: string): Promise<MemberList | null> {
    const account = (await keyStore.read()).account
    const body = bodyOf(account?.list)
    if (!account || !body) return null
    if (body.members.some((member) => member.devices.includes(device))) return null
    const members = body.members.map((member) => member.email === account.email ? { ...member, devices: [...member.devices, device] } : member)
    const base = await nextOf({ list: account.list, body })
    return signList({ signer: await keysService.device(), body: { ...base, members, runtimes: [...body.runtimes ?? [], device], added: { ...body.added, [device]: base.at ?? 0 } } })
  },

  async joinAsRuntime({ session, workspace, chain }: { session: CloudSession; workspace: Account['workspace']; chain: MemberList[] }): Promise<void> {
    const list = chain.at(-1)
    if (!list || !chain[0]) throw new HttpError(502, 'OpenHut Cloud sent no member list.')
    const account = { sub: session.sub, email: session.email, key: '', workspace, list, first: chain[0] }
    await keyStore.write({ device: (await keyStore.read()).device, machine, account, session: { token: session.token, expiresAt: session.expiresAt } })
  },

  async workspaceBox(account: Account): Promise<{ id: string; key: string; by: string; signature: string }> {
    const box = toBase64(await lock({ key: fromBase64(account.key), version: 1, bind: bind({ sub: account.sub, name: `workspace/${account.workspace.id}` }), plain: await secretOf({ room: account, own: true }) }) ?? new Uint8Array())
    const { by, signature } = await keysService.signBox({ account, name: `workspace/${account.workspace.id}`, body: box })
    return { id: account.workspace.id, key: box, by, signature }
  },

  async signBox({ account, name, body, savedAt }: { account: Account; name: string; body: string; savedAt?: number }): Promise<{ body: string; by: string; signature: string; savedAt?: number }> {
    const signer = await accountDevice(fromBase64(account.key))
    return { body, by: toBase64(signer.publicKey), signature: await signProof({ signer, proof: 'key-box', parts: boxParts({ account, name, body, savedAt }) }), savedAt }
  },

  async boxIsMine({ account, name, box }: { account: Account; name: string; box: { body: string; by?: string; signature?: string; savedAt?: string } }): Promise<boolean> {
    const by = toBase64((await accountDevice(fromBase64(account.key))).publicKey)
    const { signature } = box
    if (box.by !== by || !signature) return false
    const signed = (savedAt?: number) => checkProof({ device: by, proof: 'key-box', parts: boxParts({ account, name, body: box.body, savedAt }), signature })
    if (!(box.savedAt && await signed(Date.parse(box.savedAt))) && !await signed()) return false
    if (name === 'kit' || name === 'kit-confirmed') return true
    const plain = await unlock({ keys: { 1: fromBase64(account.key) }, bind: bind({ sub: account.sub, name: `workspace/${account.workspace.id}` }), locked: fromBase64(box.body) })
    return Boolean(plain && equal({ a: plain, b: await secretOf({ room: account, own: true }) }))
  },

  setKit: async (kit: { box: string; savedAt: string; confirmed?: boolean } | undefined): Promise<void> => keyStore.write({ ...await keyStore.read(), kit }),

  relock: async (locked: { sub: string; email: string }): Promise<void> => keyStore.write({ device: (await keyStore.read()).device, machine, session: stored()?.session, locked }),

  async restore({ words, kit, workspaces }: { words: string[]; kit: string; workspaces: Boxed[] }): Promise<Account | null> {
    const kitKey = await fromWords(words)
    const sub = stored()?.locked?.sub
    const key = kitKey && sub && await unlock({ keys: { 1: kitKey }, bind: bind({ sub, name: 'kit' }), locked: fromBase64(kit) })
    return key ? keysService.restoreWith({ key, workspaces }) : null
  },

  async restoreWith({ key, workspaces }: { key: Bytes; workspaces: Boxed[] }): Promise<Account | null> {
    const current = await keyStore.read()
    if (!current.locked) return null
    const { sub, email } = current.locked
    for (const workspace of workspaces) {
      const account = await restoreFrom({ key, workspace, sub, email, device: current.device })
      if (account) return account
    }
    return null
  },

  adopt: async ({ account, kit }: { account: Account; kit?: { box: string; savedAt: string } }): Promise<void> => keyStore.write({ device: (await keyStore.read()).device, machine, account, kit, session: stored()?.session }),

  session: (): Session | undefined => stored()?.session,

  setSession: async (session: Session | undefined): Promise<void> => keyStore.write({ ...await keyStore.read(), session }),

  ownedBy({ sub }: { sub: string }): void {
    const other = stored()?.account ?? stored()?.locked
    if (other && other.sub !== sub) throw new HttpError(409, `This ${HERE} keeps the keys of ${other.email}. ${stored()?.account && !kitOf(stored()) ? 'Sign in with that account and save a recovery kit first.' : 'Sign in with that account, or forget it below.'}`)
  },

  async open({ sub, email }: { sub: string; email: string }): Promise<Account> {
    const current = await keyStore.read()
    if (current.account?.sub === sub) return current.account
    keysService.ownedBy({ sub })
    const device = await identity(fromBase64(current.device))
    const id = toBase64(newKey(12))
    const key = newKey()
    const kit = toBase64((await accountDevice(key)).publicKey)
    const devices = [toBase64(device.publicKey), kit]
    const at = Date.now()
    const list = await signList({ signer: device, body: { workspace: id, version: 1, previous: null, members: [{ email, role: 'owner', devices, kit }], invites: [], removed: [], at, added: Object.fromEntries(devices.map((each) => [each, at])), names: { [devices[0]]: deviceName() } } })
    const account = { sub, email, key: toBase64(key), workspace: { id, key: toBase64(newKey()), version: 1 }, list, first: list }
    await keyStore.write({ device: current.device, machine, account, session: current.session })
    return account
  },

  async newKit(): Promise<{ words: string[]; box: string; ask: number[] }> {
    const account = (await keyStore.read()).account
    if (!account) throw new HttpError(409, 'Turn on OpenHut Cloud before making a recovery kit.')
    await notYoung(account)
    const { words, key } = await newWords()
    const box = await lock({ key, version: 1, bind: bind({ sub: account.sub, name: 'kit' }), plain: fromBase64(account.key) })
    return { words, box: toBase64(box ?? new Uint8Array()), ask: [randomInt(0, 6), randomInt(6, 12)] }
  },

  async forget(): Promise<void> {
    const current = await keyStore.read()
    if (current.session) throw new HttpError(409, 'Sign out of OpenHut Cloud first.')
    if (!current.account) return
    if (!kitOf(current)) throw new HttpError(409, `Save a recovery kit for ${current.account.email} first. Without one, nobody can open its backup again.`)
    await keyStore.write({ device: toBase64(newKey()), machine })
  },

  async pairingLetter({ to, secret }: { to: string; secret: string }): Promise<Sent> {
    const account = keysService.mustBeOn()
    const workspace = await pairingWorkspace({ secret, newDevice: fromBase64(to), oldDevice: (await keysService.device()).publicKey, workspace: account.workspace.id })
    return sealTo({ to, purpose: 'pairing', workspace: workspace ?? '', plain: fromBase64(account.key) })
  },

  async readPairing({ secret, workspace, found }: { secret: string; workspace: string; found: Letter }): Promise<Bytes | null> {
    const me = await keysService.device()
    const context = await pairingWorkspace({ secret, newDevice: me.publicKey, oldDevice: fromBase64(found.from), workspace })
    return context ? openLetter({ found, workspace: context }) : null
  },

  async passkeyBox(prf: Bytes): Promise<{ body: string; by: string; signature: string; savedAt?: number }> {
    const account = keysService.mustBeOn()
    const body = await lock({ key: prf, version: 1, bind: bind({ sub: account.sub, name: 'passkey' }), plain: fromBase64(account.key) })
    if (!body) throw new HttpError(400, 'Your passkey didn’t give a key OpenHut can use. Keep your recovery kit.')
    return keysService.signBox({ account, name: 'passkey', body: toBase64(body), savedAt: Date.now() })
  },

  secret: async (): Promise<Bytes> => secretOf({ room: keysService.mustBeOn(), own: true }),

  async fromPasskey({ prf, box }: { prf: Bytes; box: string }): Promise<Bytes | null> {
    const locked = stored()?.locked
    return locked ? unlock({ keys: { 1: prf }, bind: bind({ sub: locked.sub, name: 'passkey' }), locked: fromBase64(box) }) : null
  },

  async change(remove: string[]): Promise<{ list: MemberList; next: Account; letters: Sent[]; handover: { next: string; by: string; signature: string } }> {
    const account = keysService.mustBeOn()
    const body = bodyOf(account.list)
    const me = toBase64((await keysService.device()).publicKey)
    await notYoung(account)
    const mine = body?.members.find((member) => member.email === account.email)
    const oldSigner = await accountDevice(fromBase64(account.key))
    const oldKit = toBase64(oldSigner.publicKey)
    if (!body || !mine || remove.some((device) => device === me || device === oldKit || !mine.devices.includes(device))) throw new HttpError(400, 'Pick one of your other devices to remove.', { param: 'device' })
    const key = newKey()
    const kit = toBase64((await accountDevice(key)).publicKey)
    const since = Math.min(...remove.map((device) => body.added?.[device] ?? 0))
    const planted = mine.devices.filter((device) => remove.length && body.runtimes?.includes(device) && (body.added?.[device] ?? 0) >= since)
    const gone = [...remove, ...planted, oldKit].filter((device, index, all) => mine.devices.includes(device) && all.indexOf(device) === index)
    const base = await nextOf({ list: account.list, body })
    const members = body.members.map((member) => member === mine ? { ...member, devices: [...member.devices.filter((device) => !gone.includes(device)), kit], kit } : member)
    const kept = <T>(map: Record<string, T> = {}) => Object.fromEntries(Object.entries(map).filter(([device]) => !gone.includes(device)))
    const keyVersion = keyVersionOf(body) + 1
    const list = await signList({ signer: await keysService.device(), body: { ...base, members, keyVersion, removed: [...body.removed, ...gone], runtimes: body.runtimes?.filter((device) => !gone.includes(device)), added: { ...kept(body.added), [kit]: base.at ?? 0 }, names: body.names && kept(body.names) } })
    if (!await check({ anchor: await anchorOf(account.list), chain: [account.list, list] })) throw new HttpError(409, 'Your devices changed on another computer just now. Try again.')
    const { workspace } = account
    const own = workspace.own ?? toBase64(await roomKeys.own() ?? newKey())
    const next = { ...account, key: toBase64(key), list, workspace: { ...workspace, key: toBase64(newKey()), version: keyVersion, old: { ...workspace.old, [workspace.version]: workspace.key }, slot: workspace.slot ?? workspace.key, own } }
    const secret = await secretOf({ room: next, own: true })
    const shared = await secretOf({ room: next, own: false })
    const letters: Sent[] = []
    for (const member of members) {
      for (const device of member.devices.filter((each) => each !== me && each !== member.kit)) {
        letters.push(await sealTo({ to: device, purpose: 'workspace-key', workspace: workspace.id, plain: member.email === account.email ? secret : shared }))
        if (member.email === account.email && !body.runtimes?.includes(device)) letters.push(await sealTo({ to: device, purpose: 'account-key', workspace: workspace.id, plain: key }))
      }
    }
    return { list, next, letters, handover: { next: kit, by: oldKit, signature: await signProof({ signer: oldSigner, proof: 'key-box', parts: [account.sub, 'signer', kit] }) } }
  },

  mustBeOn(): Account {
    const account = stored()?.account
    if (!account?.key || !stored()?.session) throw new HttpError(409, 'Turn on OpenHut Cloud on this computer first.')
    return account
  },

  async removedHere(): Promise<void> {
    const account = (await keyStore.read()).account
    if (account) await keyStore.write({ device: toBase64(newKey()), machine, locked: account.key ? { sub: account.sub, email: account.email } : undefined })
  },
}

async function notYoung(account: Account): Promise<void> {
  const body = bodyOf(account.list)
  const until = body ? youngUntil(body, await keysService.deviceKey()) : 0
  if (until > Date.now()) throw new HttpError(403, `This ${HERE} was added less than 3 days ago, so it can’t remove an older device or change your keys yet. Do it from an older device, or wait until ${new Date(until).toLocaleDateString('en', { month: 'short', day: 'numeric' })}.`)
}

export const openLetter = async ({ found, workspace }: { found: Letter; workspace: string }): Promise<Bytes | null> =>
  read({ recipient: await keysService.device(), from: fromBase64(found.from), workspace, purpose: found.purpose, body: fromBase64(found.body), allowed: [fromBase64(found.from)] })

function deviceName(): string {
  const name = process.platform === 'darwin' ? spawnSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).stdout : ''
  return (name || hostname()).trim().slice(0, 64)
}

async function restoreFrom({ key, workspace, sub, email, device }: { key: Bytes; workspace: Boxed; sub: string; email: string; device: string }): Promise<Account | null> {
  const { chain } = workspace
  const plain = await unlock({ keys: { 1: key }, bind: bind({ sub, name: `workspace/${workspace.id}` }), locked: fromBase64(workspace.key) })
  const secret = plain && readSecret(plain)
  const body = secret && chain[0] && await check({ anchor: secret.anchor, chain })
  const last = chain.at(-1)
  if (!secret || !body || !last || body.workspace !== workspace.id) return null
  const me = toBase64((await identity(fromBase64(device))).publicKey)
  const at = Date.now()
  const members = body.members.map((member) => member.email === email && !member.devices.includes(me) ? { ...member, devices: [...member.devices, me] } : member)
  const list = await signList({ signer: await accountDevice(key), body: { ...body, version: body.version + 1, previous: await anchorOf(last), members, at, added: { ...body.added, [me]: at }, names: { ...body.names, [me]: deviceName() } } })
  const { anchor: _anchor, ...keys } = secret
  return { sub, email, key: toBase64(key), workspace: { id: workspace.id, ...keys }, list, first: chain[0] }
}

export async function sealTo({ to, purpose, workspace, plain }: { to: string; purpose: LetterPurpose; workspace: string; plain: Bytes }): Promise<Sent> {
  const body = await letter({ sender: await keysService.device(), to: fromBase64(to), workspace, purpose, version: 1, plain })
  return { to, purpose, body: toBase64(body ?? new Uint8Array()) }
}

function boxParts({ account, name, body, savedAt }: { account: Account; name: string; body: string; savedAt?: number }): string[] {
  return savedAt === undefined ? [account.sub, name, body] : [account.sub, name, body, String(savedAt)]
}

function bind({ sub, name }: { sub: string; name: string }): string {
  return `account/${sub}/${name}`
}

export async function accountDevice(key: Bytes): Promise<Identity> {
  return identity(fromBase64(await slot({ key, path: 'account-device' })))
}

function kitOf(keys: Stored | undefined): Stored['kit'] {
  return keys?.kit?.confirmed === false ? undefined : keys?.kit
}

function stored(): Stored | undefined {
  return keyStore.current()
}
