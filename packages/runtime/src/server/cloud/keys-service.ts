import { execFileSync } from 'node:child_process'
import { createHash, randomInt } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as z from 'zod/mini'
import { checkProof, MemberList, MemberListBody, parseJson, signProof, type CloudSession, type Letter, type Role } from '@openhut/common/cloud/cloud.ts'
import { addedOf, anchorOf, check, keyVersionOf, signList, YOUNG_MS } from '@openhut/common/cloud/member-list.ts'
import { equal, fromBase64, fromWords, identity, letter, lock, newKey, newWords, pairingWorkspace, read, sha256, slot, toBase64, unlock, type Bytes, type Identity, type LetterPurpose } from '@openhut/common/vault/vault.ts'
import { cloud } from '../platform/cloud.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import { HttpError } from '../platform/http-error.ts'
import { seal, unseal } from '../platform/secrets.ts'

const ROW = 'cloud_keys'
const FILE = join(config.dataDir, 'cloud-keys.sealed')
const REFRESH_EARLY_MS = 5 * 60_000
const INVITE_MS = 48 * 60 * 60_000
const INVITE_URL = 'https://openhut.dev/join'
const HERE = process.platform === 'darwin' ? 'Mac' : 'computer'
const KIT = z.object({ box: z.string(), savedAt: z.string(), confirmed: z.optional(z.boolean()) })
const Keys = z.object({ key: z.string(), version: z.number(), old: z.optional(z.record(z.string(), z.string())), slot: z.optional(z.string()), own: z.optional(z.string()) })
const Secret = z.object({ ...Keys.shape, anchor: z.string() })
const Room = z.object({ workspace: z.object({ id: z.string(), ...Keys.shape }), list: MemberList, first: z.optional(MemberList) })
const Stored = z.object({
  device: z.string(),
  machine: z.string(),
  account: z.optional(z.object({ sub: z.string(), email: z.string(), key: z.string(), ...Room.shape, teams: z.optional(z.array(Room)), links: z.optional(z.record(z.string(), z.string())) })),
  kit: z.optional(KIT),
  locked: z.optional(z.object({ sub: z.string(), email: z.string() })),
  session: z.optional(z.object({ token: z.string(), expiresAt: z.string() })),
})
type Stored = z.infer<typeof Stored>
export type Account = NonNullable<Stored['account']>
export type Session = NonNullable<Stored['session']>
export type Room = z.infer<typeof Room>
export type Sent = { to: string; purpose: LetterPurpose; body: string }
type Boxed = { id: string; key: string; chain: MemberList[] }

const keychain = Boolean(config.secret)
const machine = createHash('sha256').update(machineId()).digest('hex')
let stored = await load()

export const keysService = {
  keyStore: (): 'keychain' | 'file' => keychain ? 'keychain' : 'file',

  async device(): Promise<Identity> {
    return identity(fromBase64((await keys()).device))
  },

  deviceKey: async (): Promise<string> => toBase64((await keysService.device()).publicKey),

  async accountDeviceKey(): Promise<string | null> {
    const key = stored?.account?.key
    return key ? toBase64((await accountDevice(fromBase64(key))).publicKey) : null
  },

  account: (): Account | undefined => stored?.account,
  locked: (): { sub: string; email: string } | undefined => stored?.locked,
  members: (ws?: string): MemberListBody | undefined => bodyOf(keysService.room(ws)?.list),

  rooms: (): Room[] => stored?.account ? [stored.account, ...stored.account.teams ?? []] : [],
  room: (ws?: string): Room | undefined => keysService.rooms().find((room) => room.workspace.id === (ws ?? stored?.account?.workspace.id)),
  roleIn: (ws?: string): Role | undefined => keysService.members(ws)?.members.find((member) => member.email === stored?.account?.email)?.role,
  link: ({ ws, email }: { ws: string; email: string }): string | undefined => stored?.account?.links?.[`${ws}/${email}`],

  async own(ws?: string): Promise<Bytes | null> {
    const room = keysService.room(ws)
    const key = stored?.account?.key
    if (room?.workspace.own) return fromBase64(room.workspace.own)
    return room && key ? fromBase64(await slot({ key: fromBase64(key), path: `own/${room.workspace.id}` })) : null
  },
  kitBox: (): string | undefined => kitOf(stored)?.box,
  kitPending: (): boolean => stored?.kit?.confirmed === false,

  async setLocked(locked: { sub: string; email: string } | undefined): Promise<void> {
    await save({ ...await keys(), locked })
  },

  async token(): Promise<string> {
    const session = stored?.session
    if (!session) throw new HttpError(409, 'Turn on OpenHut Cloud first.')
    if (Date.parse(session.expiresAt) - Date.now() > REFRESH_EARLY_MS) return session.token
    const signedAt = Date.now()
    const signature = await signProof({ signer: await keysService.device(), proof: 'refresh', parts: [session.token, String(signedAt)] })
    const runtime = stored?.account && !stored.account.key ? stored.account.workspace.id : undefined
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
    const account = (await keys()).account
    const body = bodyOf(account?.list)
    if (!account || !body) return null
    if (body.members.some((member) => member.devices.includes(device))) return null
    const members = body.members.map((member) => member.email === account.email ? { ...member, devices: [...member.devices, device] } : member)
    return signList({ signer: await keysService.device(), body: { ...await nextOf({ list: account.list, body }), members, runtimes: [...body.runtimes ?? [], device], added: { ...body.added, [device]: Date.now() } } })
  },

  async joinAsRuntime({ session, workspace, chain }: { session: CloudSession; workspace: Account['workspace']; chain: MemberList[] }): Promise<void> {
    const list = chain.at(-1)
    if (!list || !chain[0]) throw new HttpError(502, 'OpenHut Cloud sent no member list.')
    const account = { sub: session.sub, email: session.email, key: '', workspace, list, first: chain[0] }
    await save({ device: (await keys()).device, machine, account, session: { token: session.token, expiresAt: session.expiresAt } })
  },

  async workspaceBox(account: Account): Promise<{ id: string; key: string; by: string; signature: string }> {
    const box = toBase64(await lock({ key: fromBase64(account.key), version: 1, bind: workspaceBind({ account, id: account.workspace.id }), plain: await secretOf({ room: account, own: true }) }) ?? new Uint8Array())
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
    if (name === 'kit') return true
    const plain = await unlock({ keys: { 1: fromBase64(account.key) }, bind: workspaceBind({ account, id: account.workspace.id }), locked: fromBase64(box.body) })
    return Boolean(plain && equal({ a: plain, b: await secretOf({ room: account, own: true }) }))
  },

  async setKit(kit: { box: string; savedAt: string; confirmed?: boolean } | undefined): Promise<void> {
    await save({ ...await keys(), kit })
  },

  async relock(locked: { sub: string; email: string }): Promise<void> {
    const current = await keys()
    await save({ device: current.device, machine, session: current.session, locked })
  },

  async restore({ words, kit, workspaces }: { words: string[]; kit: string; workspaces: Boxed[] }): Promise<Account | null> {
    const kitKey = await fromWords(words)
    const sub = stored?.locked?.sub
    const key = kitKey && sub && await unlock({ keys: { 1: kitKey }, bind: `account/${sub}/kit`, locked: fromBase64(kit) })
    return key ? keysService.restoreWith({ key, workspaces }) : null
  },

  async restoreWith({ key, workspaces }: { key: Bytes; workspaces: Boxed[] }): Promise<Account | null> {
    const current = await keys()
    if (!current.locked) return null
    const { sub, email } = current.locked
    for (const workspace of workspaces) {
      const account = await restoreFrom({ key, workspace, sub, email, device: current.device })
      if (account) return account
    }
    return null
  },

  async adopt({ account, kit }: { account: Account; kit?: { box: string; savedAt: string } }): Promise<void> {
    await save({ device: (await keys()).device, machine, account, kit, session: stored?.session })
  },

  async advance(lists: MemberList[], ws?: string): Promise<MemberListBody | null> {
    const current = await keys()
    const room = keysService.room(ws)
    if (!current.account || !room || !lists.length) return null
    const body = await check({ anchor: await anchorOf(room.list), chain: [room.list, ...lists] })
    const last = lists.at(-1)
    if (body && last) await save(withRoom(current, { ...room, list: last }))
    return body
  },

  async invite({ ws, email, role, name }: { ws: string; email: string; role: 'admin' | 'member'; name: string }): Promise<{ list: MemberList; id: string; key: string; body: string; link: string; expiresAt: string }> {
    const account = mustOwn()
    const room = keysService.room(ws)
    const body = bodyOf(room?.list)
    const mine = keysService.roleIn(ws)
    if (!room || !body || !mine || mine === 'member') throw new HttpError(403, 'Only an owner or admin can invite people.')
    if (body.members.some((member) => member.email === email)) throw new HttpError(409, `${email} is already in this workspace.`, { param: 'email' })
    const card = await identity()
    const key = toBase64(card.publicKey)
    const replaced = body.invites.filter((each) => each.email === email).map((each) => each.key)
    const list = await signList({ signer: await keysService.device(), body: { ...await nextOf({ list: room.list, body }), invites: [...body.invites.filter((each) => each.email !== email), { email, role, key }], removed: [...body.removed, ...replaced] } })
    const expiresAt = new Date(Date.now() + INVITE_MS).toISOString()
    const plain = new TextEncoder().encode(JSON.stringify({ workspace: ws, name, from: account.email, email, role, anchor: await anchorOf(firstOf(room)), expiresAt }))
    const sealed = await letter({ sender: await keysService.device(), to: card.publicKey, workspace: ws, purpose: 'invite', version: 1, plain })
    if (!sealed) throw new HttpError(500, 'This computer couldn’t seal the invite.')
    return { list, id: await inviteId(card.publicKey), key, body: toBase64(sealed), link: `${INVITE_URL}#${ws}.${toBase64(card.secret)}`, expiresAt }
  },

  async withRole({ ws, email, role }: { ws: string; email: string; role: 'admin' | 'member' }): Promise<MemberList> {
    const room = keysService.room(ws)
    const body = bodyOf(room?.list)
    const mine = keysService.roleIn(ws)
    const target = body?.members.find((member) => member.email === email)
    if (!room || !body || !mine || mine === 'member') throw new HttpError(403, 'Only an owner or admin can change roles.')
    if (!target) throw new HttpError(404, `${email} isn’t in this workspace.`)
    if (target.role === 'owner') throw new HttpError(403, 'The owner stays the owner. Hand the workspace over first.')
    return signList({ signer: await keysService.device(), body: { ...await nextOf({ list: room.list, body }), members: body.members.map((member) => member === target ? { ...member, role } : member) } })
  },

  async keepLink({ ws, email, link }: { ws: string; email: string; link: string }): Promise<void> {
    const current = await keys()
    if (current.account) await save({ ...current, account: { ...current.account, links: { ...current.account.links, [`${ws}/${email}`]: link } } })
  },

  async joinList({ card, chain, anchor, ws }: { card: Identity; chain: MemberList[]; anchor: string; ws: string }): Promise<MemberList> {
    const account = mustOwn()
    const body = await check({ anchor, chain })
    const last = chain.at(-1)
    const invite = body?.invites.find((each) => each.key === toBase64(card.publicKey) && each.email === account.email)
    if (!body || !last || !invite || body.workspace !== ws) throw new HttpError(400, 'This invite doesn’t check out. Ask for a new link.')
    const me = await keysService.deviceKey()
    const next = await nextOf({ list: last, body })
    return signList({ signer: card, body: { ...next, members: [...body.members, { email: account.email, role: invite.role, devices: [me] }], invites: body.invites.filter((each) => each !== invite), removed: [...body.removed, invite.key], added: { ...body.added, [me]: next.at ?? 0 } } })
  },

  async addTeam({ ws, list, first }: { ws: string; list: MemberList; first: MemberList }): Promise<void> {
    const current = await keys()
    if (current.account) await save(withRoom(current, { workspace: { id: ws, key: '', version: 0 }, list, first }))
  },

  async welcomeLetters({ ws, devices }: { ws: string; devices: string[] }): Promise<Sent[]> {
    const room = keysService.room(ws)
    if (!room?.workspace.key) return []
    const plain = await secretOf({ room, own: false })
    return Promise.all(devices.map((to) => sealTo({ to, purpose: 'workspace-key', workspace: ws, plain })))
  },
  session: (): Session | undefined => stored?.session,
  kit: (): { savedAt: string } | null => {
    const kit = kitOf(stored)
    return kit ? { savedAt: kit.savedAt } : null
  },

  async setSession(session: Session | undefined): Promise<void> {
    await save({ ...await keys(), session })
  },

  ownedBy({ sub }: { sub: string }): void {
    const other = stored?.account ?? stored?.locked
    if (other && other.sub !== sub) throw new HttpError(409, `This ${process.platform === 'darwin' ? 'Mac' : 'computer'} keeps the keys of ${other.email}. ${stored?.account && !kitOf(stored) ? 'Sign in with that account and save a recovery kit first.' : 'Sign in with that account, or forget it below.'}`)
  },

  async open({ sub, email }: { sub: string; email: string }): Promise<Account> {
    const current = await keys()
    if (current.account?.sub === sub) return current.account
    keysService.ownedBy({ sub })
    const device = await identity(fromBase64(current.device))
    const id = toBase64(newKey(12))
    const key = newKey()
    const kit = toBase64((await accountDevice(key)).publicKey)
    const devices = [toBase64(device.publicKey), kit]
    const at = Date.now()
    const list = await signList({ signer: device, body: { workspace: id, version: 1, previous: null, members: [{ email, role: 'owner', devices, kit }], invites: [], removed: [], at, added: Object.fromEntries(devices.map((each) => [each, at])) } })
    const account = { sub, email, key: toBase64(key), workspace: { id, key: toBase64(newKey()), version: 1 }, list, first: list }
    await save({ device: current.device, machine, account, session: current.session })
    return account
  },

  async newKit(): Promise<{ words: string[]; box: string; ask: number[] }> {
    const account = (await keys()).account
    if (!account) throw new HttpError(409, 'Turn on OpenHut Cloud before making a recovery kit.')
    return { ...await kitFor(account), ask: pick() }
  },

  async saveKit(box: string): Promise<void> {
    await save({ ...await keys(), kit: { box, savedAt: new Date().toISOString() } })
  },

  keptAccount: (): string | null => stored?.account && kitOf(stored) ? stored.account.email : null,

  async forget(): Promise<void> {
    const current = await keys()
    if (current.session) throw new HttpError(409, 'Sign out of OpenHut Cloud first.')
    if (!current.account) return
    if (!kitOf(current)) throw new HttpError(409, `Save a recovery kit for ${current.account.email} first. Without one, nobody can open its backup again.`)
    await save({ device: toBase64(newKey()), machine })
  },

  async pairingLetter({ to, secret }: { to: string; secret: string }): Promise<Sent> {
    const account = mustOwn()
    const workspace = await pairingWorkspace({ secret, newDevice: fromBase64(to), oldDevice: (await keysService.device()).publicKey, workspace: account.workspace.id })
    return sealTo({ to, purpose: 'pairing', workspace: workspace ?? '', plain: fromBase64(account.key) })
  },

  async readPairing({ secret, workspace, found }: { secret: string; workspace: string; found: Letter }): Promise<Bytes | null> {
    const me = await keysService.device()
    const context = await pairingWorkspace({ secret, newDevice: me.publicKey, oldDevice: fromBase64(found.from), workspace })
    return context ? read({ recipient: me, from: fromBase64(found.from), workspace: context, purpose: 'pairing', body: fromBase64(found.body), allowed: [fromBase64(found.from)] }) : null
  },

  async passkeyBox(prf: Bytes): Promise<{ body: string; by: string; signature: string; savedAt?: number }> {
    const account = mustOwn()
    const body = await lock({ key: prf, version: 1, bind: `account/${account.sub}/passkey`, plain: fromBase64(account.key) })
    if (!body) throw new HttpError(400, 'Your passkey didn’t give a key OpenHut can use. Keep your recovery kit.')
    return keysService.signBox({ account, name: 'passkey', body: toBase64(body), savedAt: Date.now() })
  },

  secret: async (): Promise<Bytes> => secretOf({ room: mustOwn(), own: true }),

  fromPasskey: async ({ prf, box }: { prf: Bytes; box: string }): Promise<Bytes | null> => stored?.locked ? unlock({ keys: { 1: prf }, bind: `account/${stored.locked.sub}/passkey`, locked: fromBase64(box) }) : null,

  async change(remove: string[]): Promise<{ list: MemberList; next: Account; letters: Sent[]; handover: { next: string; by: string; signature: string } }> {
    const account = mustOwn()
    const body = bodyOf(account.list)
    const me = toBase64((await keysService.device()).publicKey)
    const mine = body?.members.find((member) => member.email === account.email)
    const oldSigner = await accountDevice(fromBase64(account.key))
    const oldKit = toBase64(oldSigner.publicKey)
    if (!body || !mine || remove.some((device) => device === me || device === oldKit || !mine.devices.includes(device))) throw new HttpError(400, 'Pick one of your other devices to remove.', { param: 'device' })
    const key = newKey()
    const kit = toBase64((await accountDevice(key)).publicKey)
    const gone = [...remove, oldKit].filter((device) => mine.devices.includes(device))
    const base = await nextOf({ list: account.list, body })
    const members = body.members.map((member) => member === mine ? { ...member, devices: [...member.devices.filter((device) => !gone.includes(device)), kit], kit } : member)
    const added = Object.fromEntries(Object.entries({ ...body.added, [kit]: base.at ?? 0 }).filter(([device]) => !gone.includes(device)))
    const keyVersion = keyVersionOf(body) + 1
    const list = await signList({ signer: await keysService.device(), body: { ...base, members, keyVersion, removed: [...body.removed, ...gone], added } })
    if (!await check({ anchor: await anchorOf(account.list), chain: [account.list, list] })) throw new HttpError(403, `This ${HERE} was added less than 3 days ago, so it can’t remove an older device or change your keys yet. Do it from an older device, or wait until ${new Date(addedOf(body, me) + YOUNG_MS).toLocaleDateString('en', { month: 'short', day: 'numeric' })}.`)
    const { workspace } = account
    const own = workspace.own ?? toBase64(await keysService.own() ?? newKey())
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

  async takeLetters(found: Letter[], ws?: string): Promise<string[]> {
    const current = await keys()
    let room = keysService.room(ws)
    const body = bodyOf(room?.list)
    const home = room?.workspace.id === current.account?.workspace.id
    let account: Account | undefined = current.account
    if (!account || !room || !body) return []
    const me = await keysService.device()
    const used: string[] = []
    for (const each of found) {
      const sender = body.members.find((member) => member.devices.includes(each.from))
      const plain: Bytes | null | undefined = sender && await read({ recipient: me, from: fromBase64(each.from), workspace: body.workspace, purpose: each.purpose, body: fromBase64(each.body), allowed: [fromBase64(each.from)] })
      if (!sender || !plain) continue
      const secret = each.purpose === 'workspace-key' && sender.role !== 'member' ? readSecret(plain) : null
      if (secret && secret.anchor === await anchorOf(firstOf(room)) && secret.version === keyVersionOf(body) && secret.version > room.workspace.version) {
        const { anchor: _anchor, ...fresh } = secret
        room = { ...room, workspace: { ...room.workspace, ...fresh } }
        used.push(each.id)
      }
      const kit = home && each.purpose === 'account-key' && account.key && sender.email === account.email ? toBase64((await accountDevice(plain)).publicKey) : null
      if (kit && body.members.find((member) => member.email === account?.email)?.kit === kit) {
        account = { ...account, key: toBase64(plain) }
        used.push(each.id)
      }
    }
    if (used.length) await save({ ...withRoom({ ...current, account }, room), kit: account.key === current.account?.key ? current.kit : undefined })
    return used
  },

  async removedHere(): Promise<void> {
    const account = (await keys()).account
    if (account) await save({ device: toBase64(newKey()), machine, locked: account.key ? { sub: account.sub, email: account.email } : undefined })
  },
}

function mustOwn(): Account {
  const account = stored?.account
  if (!account?.key) throw new HttpError(409, 'Turn on OpenHut Cloud on this computer first.')
  return account
}

async function restoreFrom({ key, workspace, sub, email, device }: { key: Bytes; workspace: Boxed; sub: string; email: string; device: string }): Promise<Account | null> {
  const { chain } = workspace
  const plain = await unlock({ keys: { 1: key }, bind: `account/${sub}/workspace/${workspace.id}`, locked: fromBase64(workspace.key) })
  const secret = plain && readSecret(plain)
  const body = secret && chain[0] && await check({ anchor: secret.anchor, chain })
  const last = chain.at(-1)
  if (!secret || !body || !last || body.workspace !== workspace.id) return null
  const me = toBase64((await identity(fromBase64(device))).publicKey)
  const at = Date.now()
  const members = body.members.map((member) => member.email === email && !member.devices.includes(me) ? { ...member, devices: [...member.devices, me] } : member)
  const list = await signList({ signer: await accountDevice(key), body: { ...body, version: body.version + 1, previous: await anchorOf(last), members, at, added: { ...body.added, [me]: at } } })
  const { anchor: _anchor, ...keys } = secret
  return { sub, email, key: toBase64(key), workspace: { id: workspace.id, ...keys }, list, first: chain[0] }
}

async function secretOf({ room, own }: { room: Room; own: boolean }): Promise<Bytes> {
  const { id, own: _own, ...keys } = room.workspace
  const ownKey = own ? await keysService.own(id) : null
  return new TextEncoder().encode(JSON.stringify({ ...keys, ...ownKey && { own: toBase64(ownKey) }, anchor: await anchorOf(firstOf(room)) }))
}

function withRoom(current: Stored, room: Room): Stored {
  const account = current.account
  if (!account) return current
  if (room.workspace.id === account.workspace.id) return { ...current, account: { ...account, ...room } }
  return { ...current, account: { ...account, teams: [...(account.teams ?? []).filter((each) => each.workspace.id !== room.workspace.id), room] } }
}

export async function inviteId(key: Bytes): Promise<string> {
  return `inv_${toBase64(await sha256(key)).slice(0, 22)}`
}

export function readSecret(plain: Bytes): z.infer<typeof Secret> | null {
  if (plain.length === 64) return { key: toBase64(plain.slice(0, 32)), version: 1, anchor: toBase64(plain.slice(32)) }
  return z.safeParse(Secret, parseJson(new TextDecoder().decode(plain))).data ?? null
}

async function nextOf({ list, body }: { list: MemberList; body: MemberListBody }): Promise<MemberListBody> {
  return { ...body, version: body.version + 1, previous: await anchorOf(list), at: Math.max(Date.now(), body.at ?? 0) }
}

async function sealTo({ to, purpose, workspace, plain }: { to: string; purpose: LetterPurpose; workspace: string; plain: Bytes }): Promise<Sent> {
  const body = await letter({ sender: await keysService.device(), to: fromBase64(to), workspace, purpose, version: 1, plain })
  return { to, purpose, body: toBase64(body ?? new Uint8Array()) }
}

function boxParts({ account, name, body, savedAt }: { account: Account; name: string; body: string; savedAt?: number }): string[] {
  return savedAt === undefined ? [account.sub, name, body] : [account.sub, name, body, String(savedAt)]
}

function workspaceBind({ account, id }: { account: Account; id: string }): string {
  return `account/${account.sub}/workspace/${id}`
}

async function kitFor(account: Account): Promise<{ words: string[]; box: string }> {
  const { words, key } = await newWords()
  const box = await lock({ key, version: 1, bind: bindOf(account), plain: fromBase64(account.key) })
  return { words, box: toBase64(box ?? new Uint8Array()) }
}

async function accountDevice(key: Bytes): Promise<Identity> {
  return identity(fromBase64(await slot({ key, path: 'account-device' })))
}

function kitOf(keys: Stored | undefined): Stored['kit'] {
  return keys?.kit?.confirmed === false ? undefined : keys?.kit
}

function firstOf(room: Room): MemberList {
  return room.first ?? room.list
}

function bodyOf(list: MemberList | undefined): MemberListBody | undefined {
  return list && MemberListBody.safeParse(parseJson(new TextDecoder().decode(fromBase64(list.bytes)))).data
}

function bindOf(account: Account): string {
  return `account/${account.sub}/kit`
}

function pick(): number[] {
  const first = randomInt(0, 6)
  return [first, randomInt(6, 12)]
}

async function keys(): Promise<Stored> {
  if (stored) return stored
  stored = { device: toBase64(newKey()), machine }
  await save(stored)
  return stored
}

async function save(next: Stored): Promise<void> {
  stored = next
  const sealed = seal(JSON.stringify(next))
  if (!keychain) return writeFileSync(FILE, sealed, { mode: 0o600 })
  await db.insertInto('install_setting').values({ name: ROW, value: sealed }).onConflict((oc) => oc.column('name').doUpdateSet({ value: sealed })).execute()
}

async function load(): Promise<Stored | undefined> {
  const sealed = keychain
    ? (await db.selectFrom('install_setting').select('value').where('name', '=', ROW).executeTakeFirst())?.value
    : existsSync(FILE) ? readFileSync(FILE, 'utf8') : undefined
  const found = sealed ? z.safeParse(Stored, JSON.parse(unseal(sealed))).data : undefined
  return found?.machine === machine ? found : undefined
}

function machineId(): string {
  try {
    if (process.platform === 'darwin') return /"IOPlatformUUID" = "([^"]+)"/.exec(execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' }))?.[1] ?? ''
    return readFileSync('/etc/machine-id', 'utf8').trim()
  } catch {
    return ''
  }
}
