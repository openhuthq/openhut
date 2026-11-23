import { spawnSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { hostname } from 'node:os'
import * as z from 'zod/mini'
import { checkProof, MemberList, parseJson, signProof, type CloudSession, type Letter, type Member, type MemberListBody } from '@openhut/common/cloud/cloud.ts'
import { anchorOf, bodyOf, check, firstOf, keyVersionOf, nextOf, signList, withoutDevices, youngUntil } from '@openhut/common/cloud/member-list.ts'
import { equal, fromBase64, fromWords, identity, letter, lock, newKey, newWords, read, slot, toBase64, unlock, type Bytes, type Identity, type LetterPurpose } from '@openhut/common/vault/vault.ts'
import { cloud } from '../platform/cloud.ts'
import { HttpError } from '../platform/http-error.ts'
import { keyStore, Keys, type Account, type AskRoom, type Move, type Room, type Session, type Stored } from './key-store.ts'

const REFRESH_EARLY_MS = 5 * 60_000
export type Sent = { to: string; purpose: LetterPurpose; body: string }
type Boxed = { id: string; key: string; chain: MemberList[] }
const Secret = z.object({ ...Keys.shape, anchor: z.string(), team: z.optional(z.boolean()) })
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

  asked: (): AskRoom[] => stored()?.asking ?? [],
  setAsked: async (asking: AskRoom[]): Promise<void> => keyStore.write({ ...await keyStore.read(), asking: asking.length ? asking : undefined }),

  setLocked: async (locked: { sub: string; email: string } | undefined): Promise<void> => keyStore.write({ ...await keyStore.read(), locked }),

  async token(): Promise<string> {
    const session = stored()?.session
    if (!session) throw new HttpError(409, 'Enable OpenHut Cloud first.')
    if (Date.parse(session.expiresAt) - Date.now() > REFRESH_EARLY_MS) return session.token
    const account = stored()?.account
    const runtime = account && !account.key ? account.workspace.id : undefined
    const next = await renew(session.refresh).catch((err: unknown) => {
      if (!runtime) throw err
      return keysService.deviceSession(runtime)
    })
    await keysService.setSession({ token: next.token, refresh: next.refresh, expiresAt: next.expiresAt })
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
    const base = await nextOf({ list: account.list, body, me: await keysService.deviceKey() })
    return signList({ signer: await keysService.device(), body: { ...base, members, runtimes: [...body.runtimes ?? [], device], added: { ...body.added, [device]: base.at ?? 0 } } })
  },

  async joinAsRuntime({ session, workspace, chain }: { session: CloudSession; workspace: Account['workspace']; chain: MemberList[] }): Promise<void> {
    const list = chain.at(-1)
    if (!list || !chain[0]) throw new HttpError(502, 'OpenHut Cloud didn’t say who’s in this team. Try again.')
    const account = { sub: session.sub, email: session.email, key: '', runtime: true, workspace, list, first: chain[0] }
    await keyStore.write({ device: (await keyStore.read()).device, machine, account, session: { token: session.token, expiresAt: session.expiresAt } })
  },

  async workspaceBox({ account, room = account }: { account: Account; room?: Room }): Promise<{ id: string; key: string; by: string; signature: string }> {
    const name = `workspace/${room.workspace.id}`
    const box = toBase64(await lock({ key: fromBase64(account.key), version: 1, bind: bind({ sub: account.sub, name }), plain: await boxedSecret({ account, room }) }) ?? new Uint8Array())
    const { by, signature } = await keysService.signBox({ account, name, body: box })
    return { id: room.workspace.id, key: box, by, signature }
  },

  async signBox({ account, name, body, savedAt }: { account: Account; name: string; body: string; savedAt?: number }): Promise<{ body: string; by: string; signature: string; savedAt?: number }> {
    const signer = await accountDevice(fromBase64(account.key))
    return { body, by: toBase64(signer.publicKey), signature: await signProof({ signer, proof: 'key-box', parts: boxParts({ account, name, body, savedAt }) }), savedAt }
  },

  async boxIsMine({ account, room = account, name, box }: { account: Account; room?: Room; name: string; box: { body: string; by?: string; signature?: string; savedAt?: string } }): Promise<boolean> {
    const by = toBase64((await accountDevice(fromBase64(account.key))).publicKey)
    const { signature } = box
    if (box.by !== by || !signature) return false
    const signed = (savedAt?: number) => checkProof({ device: by, proof: 'key-box', parts: boxParts({ account, name, body: box.body, savedAt }), signature })
    if (!(box.savedAt && await signed(Date.parse(box.savedAt))) && !await signed()) return false
    if (name === 'kit' || name === 'kit-confirmed') return true
    const plain = await unlock({ keys: { 1: fromBase64(account.key) }, bind: bind({ sub: account.sub, name: `workspace/${room.workspace.id}` }), locked: fromBase64(box.body) })
    return Boolean(plain && equal({ a: plain, b: await boxedSecret({ account, room }) }))
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
    let account: Account | null = null
    for (const workspace of workspaces) account ??= await restoreFrom({ key, workspace, sub, email, device: current.device })
    if (!account) return null
    const home = account.workspace.id
    const teams: Room[] = []
    for (const workspace of workspaces.filter((each) => each.id !== home)) {
      const team = await restoreTeam({ key, workspace, sub, email, device: current.device })
      if (team) teams.push(team)
    }
    return teams.length ? { ...account, teams } : account
  },

  adopt: async ({ account, kit, moves }: { account: Account; kit?: { box: string; savedAt: string }; moves?: Move[] }): Promise<void> => keyStore.write({ device: (await keyStore.read()).device, machine, account, kit, moves, session: stored()?.session }),

  moves: (): Move[] => stored()?.moves ?? [],
  setMoves: async (moves: Move[]): Promise<void> => keyStore.write({ ...await keyStore.read(), moves: moves.length ? moves : undefined }),

  session: (): Session | undefined => stored()?.session,

  setSession: async (session: Session | undefined): Promise<void> => keyStore.write({ ...await keyStore.read(), session }),

  ownedBy({ sub }: { sub: string }): void {
    const other = stored()?.account ?? stored()?.locked
    if (other && other.sub !== sub) throw new HttpError(409, `This computer is set up for ${other.email}. Sign in with that account.`)
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
    if (!account) throw new HttpError(409, 'Enable OpenHut Cloud before making a recovery kit.')
    await notYoung(account)
    const { words, key } = await newWords()
    const box = await lock({ key, version: 1, bind: bind({ sub: account.sub, name: 'kit' }), plain: fromBase64(account.key) })
    return { words, box: toBase64(box ?? new Uint8Array()), ask: [randomInt(0, 6), randomInt(6, 12)] }
  },


  async accountLetter(to: string): Promise<Sent> {
    const account = keysService.mustBeOn()
    return sealTo({ to, purpose: 'account-key', workspace: account.workspace.id, plain: fromBase64(account.key) })
  },

  async passkeyBox(prf: Bytes): Promise<{ body: string; by: string; signature: string; savedAt?: number }> {
    const account = keysService.mustBeOn()
    const body = await lock({ key: prf, version: 1, bind: bind({ sub: account.sub, name: 'passkey' }), plain: fromBase64(account.key) })
    if (!body) throw new HttpError(400, 'Your password manager’s passkey can’t unlock OpenHut. Use Touch ID or your recovery kit.')
    return keysService.signBox({ account, name: 'passkey', body: toBase64(body), savedAt: Date.now() })
  },

  secret: async (): Promise<Bytes> => secretOf({ room: keysService.mustBeOn(), own: true }),

  async fromPasskey({ prf, box }: { prf: Bytes; box: string }): Promise<Bytes | null> {
    const locked = stored()?.locked
    return locked ? unlock({ keys: { 1: prf }, bind: bind({ sub: locked.sub, name: 'passkey' }), locked: fromBase64(box) }) : null
  },

  async dropDevices(remove: string[]): Promise<MemberList> {
    const account = keysService.mustBeOn()
    const body = bodyOf(account.list)
    const me = await keysService.deviceKey()
    await notYoung(account)
    const mine = body?.members.find((member) => member.email === account.email)
    if (!body || !mine || !remove.length || remove.some((device) => device === me || device === mine.kit || !mine.devices.includes(device))) throw new HttpError(400, 'Pick one of your other devices to remove.', { param: 'device' })
    const since = Math.min(...remove.map((device) => body.added?.[device] ?? 0))
    const planted = mine.devices.filter((device) => body.runtimes?.includes(device) && (body.added?.[device] ?? 0) >= since)
    const gone = [...new Set([...remove, ...planted])]
    return signList({ signer: await keysService.device(), body: withoutDevices({ body: await nextOf({ list: account.list, body, me }), gone }) })
  },

  async change(): Promise<{ list: MemberList; next: Account; letters: Sent[] }> {
    const account = keysService.mustBeOn()
    const body = bodyOf(account.list)
    const me = toBase64((await keysService.device()).publicKey)
    await notYoung(account)
    const mine = body?.members.find((member) => member.email === account.email)
    const oldKit = toBase64((await accountDevice(fromBase64(account.key))).publicKey)
    if (!body || !mine) throw new HttpError(409, `Enable OpenHut Cloud on this computer first.`)
    const key = newKey()
    const kit = toBase64((await accountDevice(key)).publicKey)
    const gone = mine.devices.includes(oldKit) ? [oldKit] : []
    const base = withoutDevices({ body: await nextOf({ list: account.list, body, me }), gone })
    const members = base.members.map((member) => member.email === account.email ? { ...member, devices: [...member.devices, kit], kit } : member)
    const keyVersion = keyVersionOf(body) + 1
    const list = await signList({ signer: await keysService.device(), body: { ...base, members, keyVersion, added: { ...base.added, [kit]: base.at ?? 0 } } })
    if (!await check({ anchor: await anchorOf(account.list), chain: [account.list, list] })) throw new HttpError(409, 'Your devices changed on another computer just now. Try again.')
    const { next, letters } = await rotateKeys({ room: { ...account, key: toBase64(key) }, list, keyVersion, members, me })
    const own = members.find((member) => member.email === account.email)?.devices.filter((device) => device !== me && device !== kit && !body.runtimes?.includes(device)) ?? []
    for (const to of own) letters.push(await sealTo({ to, purpose: 'account-key', workspace: account.workspace.id, plain: key }))
    return { list, next, letters }
  },

  mustBeOn(): Account {
    const account = stored()?.account
    if (!account?.key || !stored()?.session) throw new HttpError(409, `Enable OpenHut Cloud on this computer first.`)
    return account
  },

  async deleteProof(ws: string): Promise<{ signedAt: number; signature: string }> {
    const signedAt = Date.now()
    return { signedAt, signature: await signProof({ signer: await keysService.device(), proof: 'delete', parts: [ws, String(signedAt)] }) }
  },

  async accountProof(): Promise<{ by: string; signature: string }> {
    const account = keysService.mustBeOn()
    const signer = await accountDevice(fromBase64(account.key))
    return { by: toBase64(signer.publicKey), signature: await signProof({ signer, proof: 'key-box', parts: [account.sub, 'delete-account', ''] }) }
  },

  forgetHere: async (): Promise<void> => keyStore.write({ device: toBase64(newKey()), machine }),

  async removedHere(): Promise<void> {
    const { account, locked } = await keyStore.read()
    const who = account?.key ? { sub: account.sub, email: account.email } : locked
    if (account || locked) await keyStore.write({ device: toBase64(newKey()), machine, locked: who })
  },
}

export async function notYoung(account: Account): Promise<void> {
  const body = bodyOf(account.list)
  if (body) notYoungIn({ body, device: await keysService.deviceKey() })
}

export function notYoungIn({ body, device }: { body: MemberListBody; device: string }): void {
  const until = youngUntil(body, device)
  if (until > Date.now()) throw new HttpError(403, `This computer was added less than 3 days ago, so it can’t remove devices or reset encryption yet. Do it from an older one, or wait until ${new Date(until).toLocaleDateString('en', { month: 'short', day: 'numeric' })}.`)
}

export const openLetter = async ({ found, workspace }: { found: Letter; workspace: string }): Promise<Bytes | null> =>
  read({ recipient: await keysService.device(), from: fromBase64(found.from), workspace, purpose: found.purpose, body: fromBase64(found.body), allowed: [fromBase64(found.from)] })

export function deviceOs(): string {
  if (process.platform !== 'darwin') return process.platform === 'win32' ? 'Windows' : 'Linux'
  const version = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim().split('.')[0]
  return version ? `macOS ${version}` : 'macOS'
}

export function deviceName(): string {
  const name = process.platform === 'darwin' ? spawnSync('scutil', ['--get', 'ComputerName'], { encoding: 'utf8' }).stdout : ''
  return (name || hostname()).trim().slice(0, 64)
}

async function restoreFrom({ key, workspace, sub, email, device }: { key: Bytes; workspace: Boxed; sub: string; email: string; device: string }): Promise<Account | null> {
  const { chain } = workspace
  const plain = await unlock({ keys: { 1: key }, bind: bind({ sub, name: `workspace/${workspace.id}` }), locked: fromBase64(workspace.key) })
  const secret = plain && readSecret(plain)
  const body = secret && !secret.team && chain[0] && await check({ anchor: secret.anchor, chain })
  const last = chain.at(-1)
  if (!secret || !body || !last || body.workspace !== workspace.id) return null
  const me = toBase64((await identity(fromBase64(device))).publicKey)
  const at = Date.now()
  const members = body.members.map((member) => member.email === email && !member.devices.includes(me) ? { ...member, devices: [...member.devices, me] } : member)
  const list = await signList({ signer: await accountDevice(key), body: { ...body, version: body.version + 1, previous: await anchorOf(last), members, at, added: { ...body.added, [me]: at }, names: { ...body.names, [me]: deviceName() } } })
  const { anchor: _anchor, team: _team, ...keys } = secret
  return { sub, email, key: toBase64(key), workspace: { id: workspace.id, ...keys }, list, first: chain[0] }
}

async function restoreTeam({ key, workspace, sub, email, device }: { key: Bytes; workspace: Boxed; sub: string; email: string; device: string }): Promise<Room | null> {
  const { chain } = workspace
  const plain = await unlock({ keys: { 1: key }, bind: bind({ sub, name: `workspace/${workspace.id}` }), locked: fromBase64(workspace.key) })
  const secret = plain && readSecret(plain)
  const body = secret?.team && chain[0] && await check({ anchor: secret.anchor, chain })
  const last = chain.at(-1)
  const signer = await accountDevice(key)
  const mine = body ? body.members.find((member) => member.email === email) : undefined
  if (!secret || !body || !last || !chain[0] || body.workspace !== workspace.id || !mine?.devices.includes(toBase64(signer.publicKey))) return null
  const me = toBase64((await identity(fromBase64(device))).publicKey)
  const base = await nextOf({ list: last, body, me })
  const fresh = !mine.devices.includes(me)
  const members = body.members.map((member) => member === mine ? { ...member, devices: fresh ? [...member.devices, me] : member.devices, kit: toBase64(signer.publicKey) } : member)
  const list = await signList({ signer, body: { ...base, members, ...fresh && { added: { ...body.added, [me]: base.at ?? 0 }, names: { ...body.names, [me]: deviceName() } } } })
  const { anchor: _anchor, team: _team, ...keys } = secret
  return { workspace: { id: workspace.id, ...keys }, list, first: chain[0] }
}

export async function ownOf(room: Room): Promise<Bytes | null> {
  const key = stored()?.account?.key
  if (room.workspace.own) return fromBase64(room.workspace.own)
  return key ? fromBase64(await slot({ key: fromBase64(key), path: `own/${room.workspace.id}` })) : null
}

export async function secretOf({ room, own, team = false }: { room: Room; own: boolean; team?: boolean }): Promise<Bytes> {
  const { id: _id, own: _own, ...keys } = room.workspace
  const ownKey = own ? await ownOf(room) : null
  return new TextEncoder().encode(JSON.stringify({ ...keys, ...ownKey && { own: toBase64(ownKey) }, anchor: await anchorOf(firstOf(room)), ...team && { team } }))
}

export function readSecret(plain: Bytes): z.infer<typeof Secret> | null {
  if (plain.length === 64) return { key: toBase64(plain.slice(0, 32)), version: 1, anchor: toBase64(plain.slice(32)) }
  return z.safeParse(Secret, parseJson(new TextDecoder().decode(plain))).data ?? null
}

export async function rotateKeys<R extends Room>({ room, list, keyVersion, members, me }: { room: R; list: MemberList; keyVersion: number; members: Member[]; me: string }): Promise<{ next: R; letters: Sent[] }> {
  const { workspace } = room
  const own = workspace.own ?? (stored()?.account?.key ? toBase64(await ownOf(room) ?? newKey()) : undefined)
  const next = { ...room, list, workspace: { ...workspace, key: toBase64(newKey()), version: keyVersion, old: { ...workspace.old, [workspace.version]: workspace.key }, slot: workspace.slot ?? workspace.key, ...own && { own } } }
  const secret = await secretOf({ room: next, own: true })
  const shared = await secretOf({ room: next, own: false })
  const email = stored()?.account?.email
  const letters = await Promise.all(members.flatMap((member) => member.devices.filter((device) => device !== me && device !== member.kit).map((to) => sealTo({ to, purpose: 'workspace-key', workspace: workspace.id, plain: member.email === email ? secret : shared }))))
  return { next, letters }
}

async function boxedSecret({ account, room }: { account: Account; room: Room }): Promise<Bytes> {
  return secretOf({ room, own: true, team: room.workspace.id !== account.workspace.id })
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

async function renew(refresh: string | undefined): Promise<CloudSession> {
  if (!refresh) throw new HttpError(502, 'You were signed out. Sign in again.')
  const signedAt = Date.now()
  const signature = await signProof({ signer: await keysService.device(), proof: 'refresh', parts: [refresh, String(signedAt)] })
  return cloud.refresh({ session: refresh, signedAt, signature })
}
