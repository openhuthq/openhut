import * as z from 'zod/mini'
import { Letter, MemberList, type MemberListBody, type Role } from '@openhut/common/cloud/cloud.ts'
import { anchorOf, bodyOf, check, firstOf, keyVersionOf, nextOf, signList, withoutDevices } from '@openhut/common/cloud/member-list.ts'
import { fromBase64, identity, letter, lock, lockInvite, newKey, sha256, toBase64, unlock, type Bytes, type Identity } from '@openhut/common/vault/vault.ts'
import { cloud } from '../platform/cloud.ts'
import { log } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { keyStore, type Account, type Outgoing, type Room, type Stored } from './key-store.ts'
import { accountDevice, deviceName, keysService, openLetter, ownOf, readSecret, rotateKeys, sealTo, secretOf, type Sent } from './keys-service.ts'

const INVITE_MS = 48 * 60 * 60_000
const INVITE_URL = 'https://openhut.dev/join'
const Lists = z.object({ data: z.array(MemberList) })
const Letters = z.object({ data: z.array(Letter) })

export type Call = (input: { method: 'GET' | 'PUT' | 'POST' | 'DELETE'; path: string; body?: unknown }) => Promise<{ status: number; json: unknown }>

export const roomKeys = {
  rooms: (): Room[] => {
    const account = keyStore.current()?.account
    return account ? [account, ...account.teams ?? []] : []
  },

  room: (ws?: string): Room | undefined => roomKeys.rooms().find((room) => room.workspace.id === (ws ?? keyStore.current()?.account?.workspace.id)),
  members: (ws?: string): MemberListBody | undefined => bodyOf(roomKeys.room(ws)?.list),
  roleIn: (ws?: string): Role | undefined => roomKeys.members(ws)?.members.find((member) => member.email === keyStore.current()?.account?.email)?.role,
  link: ({ ws, email }: { ws: string; email: string }): string | undefined => keyStore.current()?.account?.links?.[`${ws}/${email}`],

  async own(ws?: string): Promise<Bytes | null> {
    const room = roomKeys.room(ws)
    return room ? ownOf(room) : null
  },

  async lockMeta({ ws, field, plain }: { ws: string; field: MetaField; plain: string }): Promise<string> {
    const workspace = roomKeys.room(ws)?.workspace
    const locked = workspace?.key && await lock({ key: fromBase64(workspace.key), version: workspace.version, bind: metaBind({ ws, field }), plain: new TextEncoder().encode(plain) })
    if (!locked) throw new HttpError(409, 'This computer is still joining the team. Try again in a moment.')
    return toBase64(locked)
  },

  async openMeta({ ws, field, locked }: { ws: string; field: MetaField; locked: string | null | undefined }): Promise<string | null> {
    const workspace = roomKeys.room(ws)?.workspace
    if (!workspace?.key || !locked) return null
    const keys = Object.fromEntries([...Object.entries(workspace.old ?? {}), [String(workspace.version), workspace.key]].map(([version, key]) => [Number(version), fromBase64(key)]))
    const plain = await unlock({ keys, bind: metaBind({ ws, field }), locked: fromBase64(locked) }).catch(() => null)
    return plain && new TextDecoder().decode(plain)
  },

  async advance({ lists, ws }: { lists: MemberList[]; ws?: string }): Promise<MemberListBody | null> {
    const current = await keyStore.read()
    const room = roomKeys.room(ws)
    if (!current.account || !room || !lists.length) return null
    const body = await check({ anchor: await anchorOf(room.list), chain: [room.list, ...lists] })
    const last = lists.at(-1)
    const now = keyStore.current()
    const fresh = roomKeys.room(room.workspace.id)
    if (!body || !last || !now || !fresh || fresh.list.bytes !== room.list.bytes) return null
    const pending = now.rotating?.find((each) => each.room.workspace.id === fresh.workspace.id)
    const landed = pending && lists.some((list) => list.bytes === pending.room.list.bytes)
    const settled = pending && (bodyOf(pending.room.list)?.version ?? 0) <= body.version
    const workspace = landed ? pending.room.workspace : fresh.workspace
    await keyStore.write({ ...withRoom(now, { workspace, list: last, first: fresh.first }), rotating: settled ? now.rotating?.filter((each) => each !== pending) : now.rotating, outbox: landed ? [...now.outbox ?? [], ...pending.letters] : now.outbox })
    return body
  },

  async invite({ ws, email, role, name }: { ws: string; email: string; role: 'admin' | 'member'; name: string }): Promise<{ list: MemberList; id: string; key: string; body: string; link: string; expiresAt: string }> {
    const account = keysService.mustBeOn()
    const { room, body } = adminRoom({ ws, sentence: 'Only an owner or admin can invite people.' })
    if (body.members.some((member) => member.email === email)) throw new HttpError(409, `${email} is already in this team.`, { param: 'email' })
    const card = await identity()
    const key = toBase64(card.publicKey)
    const replaced = body.invites.filter((each) => each.email === email).map((each) => each.key)
    const list = await signList({ signer: await keysService.device(), body: { ...await nextOf({ list: room.list, body, me: await keysService.deviceKey() }), invites: [...body.invites.filter((each) => each.email !== email), { email, role, key }], removed: [...body.removed, ...replaced] } })
    const expiresAt = new Date(Date.now() + INVITE_MS).toISOString()
    const plain = await lockInvite({ secret: card.secret, workspace: ws, plain: new TextEncoder().encode(JSON.stringify({ workspace: ws, name, from: account.email, email, role, anchor: await anchorOf(firstOf(room)), expiresAt })) })
    const sealed = plain && await letter({ sender: await keysService.device(), to: card.publicKey, workspace: ws, purpose: 'invite', version: 1, plain })
    if (!sealed) throw new HttpError(500, 'Couldn’t make the invite. Try again.')
    return { list, id: await inviteId(card.publicKey), key, body: toBase64(sealed), link: `${INVITE_URL}#${ws}.${toBase64(card.secret)}`, expiresAt }
  },

  async revoke({ ws, email }: { ws: string; email: string }): Promise<MemberList> {
    const { room, body } = adminRoom({ ws, sentence: 'Only an owner or admin can revoke an invite.' })
    const gone = body.invites.filter((each) => each.email === email).map((each) => each.key)
    if (!gone.length) throw new HttpError(404, `There’s no pending invite for ${email}.`)
    return signList({ signer: await keysService.device(), body: { ...await nextOf({ list: room.list, body, me: await keysService.deviceKey() }), invites: body.invites.filter((each) => each.email !== email), removed: [...body.removed, ...gone] } })
  },

  async withRole({ ws, email, role }: { ws: string; email: string; role: Role }): Promise<MemberList> {
    const { room, body } = adminRoom({ ws, sentence: 'Only an owner or admin can change roles.' })
    const target = body.members.find((member) => member.email === email)
    const mine = roomKeys.roleIn(ws)
    if (!target) throw new HttpError(404, `${email} isn’t in this team.`)
    if (target.role === 'owner') throw new HttpError(403, 'You can’t change the owner’s role. Make someone else the owner first.')
    if (role === 'owner' && (mine !== 'owner' || roomKeys.isOwn(ws))) throw new HttpError(403, mine === 'owner' ? 'Your own team stays yours. Make a new team, then make someone else its owner.' : 'Only the owner can make someone else the owner.')
    const me = keyStore.current()?.account?.email
    const roleAfter = (member: MemberListBody['members'][number]): Role => {
      if (member === target) return role
      if (role === 'owner' && member.email === me) return 'admin'
      return member.role
    }
    const members = body.members.map((member) => ({ ...member, role: roleAfter(member) }))
    return signList({ signer: await keysService.device(), body: { ...await nextOf({ list: room.list, body, me: await keysService.deviceKey() }), members } })
  },

  isOwn: (ws: string): boolean => Boolean(keyStore.current()?.account?.key || keyStore.current()?.account?.runtime) && keyStore.current()?.account?.workspace.id === ws,

  async teamChange({ ws, emails = [], devices = [], rotate = false }: { ws: string; emails?: string[]; devices?: string[]; rotate?: boolean }): Promise<{ list: MemberList; room: Room; letters: Sent[] }> {
    const account = keyStore.current()?.account
    const room = roomKeys.room(ws)
    const body = bodyOf(room?.list)
    const mine = roomKeys.roleIn(ws)
    const me = await keysService.deviceKey()
    const leaving = Boolean(account && emails.includes(account.email))
    if (!account || !room || !body || !mine) throw new HttpError(409, 'Enable OpenHut Cloud and open this team first.')
    if (emails.some((email) => email !== account.email && (mine === 'member' || body.members.find((member) => member.email === email)?.role === 'owner'))) throw new HttpError(403, 'Only an owner or admin can remove people, and nobody can remove the owner.')
    if (leaving && mine === 'owner') throw new HttpError(403, 'Make someone else the owner first.')
    if (leaving && roomKeys.isOwn(ws)) throw new HttpError(403, 'This is your own team. To remove it, delete your cloud account in Settings › Backup.')
    if (rotate && mine === 'member') throw new HttpError(403, 'Only an owner or admin can reset encryption.')
    const gone = [...body.members.filter((member) => emails.includes(member.email)).flatMap((member) => member.devices), ...devices.filter((device) => body.members.some((member) => member.devices.includes(device)))]
    if (devices.some((device) => !body.members.some((member) => member.email === account.email && member.devices.includes(device))) && mine === 'member') throw new HttpError(403, 'Only an owner or admin can remove someone else’s device.')
    const base = withoutDevices({ body: await nextOf({ list: room.list, body, me }), gone })
    const members = base.members.filter((member) => !emails.includes(member.email))
    const keyVersion = keyVersionOf(body) + (rotate ? 1 : 0)
    const list = await signList({ signer: await keysService.device(), body: { ...base, members, keyVersion } })
    if (!rotate) return { list, room: { ...room, list }, letters: [] }
    const { next, letters } = await rotateKeys({ room, list, keyVersion, members, me })
    return { list, room: next, letters }
  },

  async approve({ ws, email, device, name }: { ws: string; email: string; device: string; name?: string | null }): Promise<{ list: MemberList; letter: Sent }> {
    const { room, body } = adminRoom({ ws, sentence: 'Only an owner or admin can let a new device in.' })
    const target = body.members.find((member) => member.email === email)
    if (!room.workspace.key) throw new HttpError(409, 'This computer is still joining the team. Try again in a moment.')
    if (!target || body.members.some((member) => member.devices.includes(device))) throw new HttpError(409, `${email} isn’t waiting with that device anymore.`)
    const base = await nextOf({ list: room.list, body, me: await keysService.deviceKey() })
    const list = await signList({ signer: await keysService.device(), body: { ...base, members: body.members.map((member) => member === target ? { ...member, devices: [...member.devices, device] } : member), added: { ...body.added, [device]: base.at ?? 0 }, ...name && { names: { ...body.names, [device]: name.slice(0, 64) } } } })
    return { list, letter: await sealTo({ to: device, purpose: 'workspace-key', workspace: ws, plain: await secretOf({ room, own: false }) }) }
  },

  async joinApproved({ ws, chain, found }: { ws: string; chain: MemberList[]; found: Letter[] }): Promise<boolean> {
    const current = await keyStore.read()
    const who = current.account ?? current.locked
    const me = await keysService.deviceKey()
    for (const each of found.filter((one) => one.purpose === 'workspace-key')) {
      const plain = await openLetter({ found: each, workspace: ws })
      const secret = plain && readSecret(plain)
      const body = secret && chain[0] && await check({ anchor: secret.anchor, chain })
      const last = chain.at(-1)
      const sender = body ? body.members.find((member) => member.devices.includes(each.from)) : undefined
      if (!who || !secret || !body || !last || !chain[0] || !sender || sender.role === 'member' || body.workspace !== ws || secret.version !== keyVersionOf(body)) continue
      if (!body.members.some((member) => member.email === who.email && member.devices.includes(me))) continue
      const { anchor: _anchor, ...fresh } = secret
      const room = { workspace: { id: ws, ...fresh }, list: last, first: chain[0] }
      const now = await keyStore.read()
      await keyStore.write(now.account ? withRoom(now, room) : { ...now, account: { sub: who.sub, email: who.email, key: '', ...room } })
      return true
    }
    return false
  },

  async createTeam(): Promise<Room> {
    const account = keysService.mustBeOn()
    const device = await keysService.device()
    const me = toBase64(device.publicKey)
    const id = toBase64(newKey(12))
    const at = Date.now()
    const list = await signList({ signer: device, body: { workspace: id, version: 1, previous: null, members: [{ email: account.email, role: 'owner', devices: [me] }], invites: [], removed: [], at, added: { [me]: at }, names: { [me]: deviceName() } } })
    const room = { workspace: { id, key: toBase64(newKey()), version: 1 }, list, first: list }
    await keyStore.write(withRoom(await keyStore.read(), room))
    return room
  },

  async dropRoom(ws: string): Promise<void> {
    const current = await keyStore.read()
    const account = current.account
    if (!account) return
    if (account.workspace.id !== ws) return keyStore.write({ ...current, account: { ...account, teams: (account.teams ?? []).filter((each) => each.workspace.id !== ws), links: Object.fromEntries(Object.entries(account.links ?? {}).filter(([key]) => !key.startsWith(`${ws}/`))) } })
    if (account.key) return keyStore.write({ device: toBase64(newKey()), machine: keyStore.machine })
    const [next, ...rest] = account.teams ?? []
    if (next) return keyStore.write({ ...current, account: { ...account, ...next, teams: rest } })
    return keyStore.write({ device: current.device, machine: keyStore.machine, session: current.session, locked: current.locked ?? { sub: account.sub, email: account.email } })
  },

  async setRoom(room: Room): Promise<void> {
    const current = await keyStore.read()
    await keyStore.write({ ...withRoom(current, room), rotating: current.rotating?.filter((each) => each.room.workspace.id !== room.workspace.id) })
  },

  async post(letters: Outgoing[] = []): Promise<number> {
    const current = await keyStore.read()
    const all = [...current.outbox ?? [], ...letters]
    if (letters.length) await keyStore.write({ ...current, outbox: all })
    if (!all.length || !current.session) return 0
    const token = await keysService.token()
    const failed: Outgoing[] = []
    for (const { workspace, ...each } of all) {
      const { status } = await cloud.room({ method: 'POST', workspace, path: '/letters', token, body: each }).catch(() => ({ status: 0 }))
      if ([0, 401, 429].includes(status) || status >= 500) failed.push({ ...each, workspace })
    }
    if (failed.length) log.warn({ event: 'cloud.letters_queued', count: failed.length })
    const now = await keyStore.read()
    await keyStore.write({ ...now, outbox: [...failed, ...(now.outbox ?? []).filter((each) => !all.includes(each))] })
    return failed.filter((each) => letters.some((sent) => sent.body === each.body)).length
  },

  async setRotating(pending: { room: Room; letters: Outgoing[] } | { ws: string }): Promise<void> {
    const current = await keyStore.read()
    const ws = 'ws' in pending ? pending.ws : pending.room.workspace.id
    const rest = (current.rotating ?? []).filter((each) => each.room.workspace.id !== ws)
    await keyStore.write({ ...current, rotating: 'ws' in pending ? rest : [...rest, pending] })
  },

  async keepLink({ ws, email, link }: { ws: string; email: string; link: string }): Promise<void> {
    const current = await keyStore.read()
    if (current.account) await keyStore.write({ ...current, account: { ...current.account, links: { ...current.account.links, [`${ws}/${email}`]: link } } })
  },

  async joinList({ card, chain, anchor, ws }: { card: Identity; chain: MemberList[]; anchor: string; ws: string }): Promise<MemberList> {
    const account = keysService.mustBeOn()
    const body = await check({ anchor, chain })
    const last = chain.at(-1)
    const invite = body?.invites.find((each) => each.key === toBase64(card.publicKey) && each.email === account.email)
    if (!body || !last || !invite || body.workspace !== ws) throw new HttpError(400, 'This invite link doesn’t work. Ask for a new one.')
    const me = await keysService.deviceKey()
    const next = await nextOf({ list: last, body, me })
    return signList({ signer: card, body: { ...next, members: [...body.members, { email: account.email, role: invite.role, devices: [me] }], invites: body.invites.filter((each) => each !== invite), removed: [...body.removed.filter((key) => key !== me), invite.key], added: { ...body.added, [me]: next.at ?? 0 }, names: { ...body.names, [me]: deviceName() } } })
  },

  async addTeam({ ws, list, first }: { ws: string; list: MemberList; first: MemberList }): Promise<void> {
    const current = await keyStore.read()
    if (current.account) await keyStore.write(withRoom(current, { workspace: { id: ws, key: '', version: 0 }, list, first }))
  },

  async welcomeLetters({ ws, devices }: { ws: string; devices: string[] }): Promise<Sent[]> {
    const room = roomKeys.room(ws)
    if (!room?.workspace.key) return []
    const plain = await secretOf({ room, own: false })
    return Promise.all(devices.map((to) => sealTo({ to, purpose: 'workspace-key', workspace: ws, plain })))
  },

  async takeLetters({ found, ws }: { found: Letter[]; ws?: string }): Promise<string[]> {
    const current = await keyStore.read()
    let room = roomKeys.room(ws)
    const body = bodyOf(room?.list)
    const home = room?.workspace.id === current.account?.workspace.id
    let account: Account | undefined = current.account
    if (!account || !room || !body) return []
    const done: string[] = []
    for (const each of found) {
      const sender = body.members.find((member) => member.devices.includes(each.from))
      const plain: Bytes | null | undefined = sender && await openLetter({ found: each, workspace: body.workspace })
      const secret = sender && plain && each.purpose === 'workspace-key' && sender.role !== 'member' ? readSecret(plain) : null
      const kit = sender && plain && home && each.purpose === 'account-key' && account.key && sender.email === account.email ? toBase64((await accountDevice(plain)).publicKey) : null
      if (secret && secret.anchor === await anchorOf(firstOf(room)) && secret.version === keyVersionOf(body) && secret.version > room.workspace.version) {
        room = { ...room, workspace: taken({ workspace: room.workspace, secret, mine: sender?.email === account.email }) }
      } else if (plain && kit && body.members.find((member) => member.email === account?.email)?.kit === kit) account = { ...account, key: toBase64(plain) }
      else if ((secret && secret.version > keyVersionOf(body)) || (kit && !body.removed.includes(kit))) continue
      done.push(each.id)
    }
    const now = keyStore.current()
    const fresh = roomKeys.room(room.workspace.id)
    if (!done.length || !now?.account || !fresh || now.account.sub !== account.sub) return done
    const key = account.key === current.account?.key ? now.account.key : account.key
    const workspace = fresh.workspace.version > room.workspace.version ? fresh.workspace : room.workspace
    await keyStore.write({ ...withRoom({ ...now, account: { ...now.account, key } }, { workspace, list: fresh.list, first: fresh.first }), kit: key === now.account.key ? now.kit : undefined })
    return done
  },

  async refresh({ ws, call }: { ws: string; call: Call }): Promise<{ changed: boolean; behind: boolean }> {
    const before = roomKeys.members(ws)
    const reply = await call({ method: 'GET', path: `/member-lists?after=${before?.version ?? 0}` })
    const after = await roomKeys.advance({ lists: Lists.safeParse(reply.json).data?.data ?? [], ws })
    if (before && after) await welcome({ ws, call, before, after })
    await listKit({ ws, call })
    return { changed: Boolean(after), behind: await roomKeys.rekey({ ws, call }) }
  },

  async rekey({ ws, call }: { ws: string; call: Call }): Promise<boolean> {
    if (!await behind(ws)) return false
    const found = Letters.safeParse((await call({ method: 'GET', path: '/letters' })).json).data?.data ?? []
    for (const id of await roomKeys.takeLetters({ found, ws })) await call({ method: 'DELETE', path: `/letters/${id}` })
    return behind(ws)
  },
}

function taken({ workspace, secret, mine }: { workspace: Room['workspace']; secret: NonNullable<ReturnType<typeof readSecret>>; mine: boolean }): Room['workspace'] {
  const { key, version } = secret
  const old = { ...secret.old, ...workspace.old, ...workspace.key && { [workspace.version]: workspace.key } }
  const slotKey = workspace.key ? workspace.slot ?? workspace.key : secret.slot
  const own = mine ? secret.own ?? workspace.own : workspace.own
  return { id: workspace.id, key, version, ...Object.keys(old).length && { old }, ...slotKey && { slot: slotKey }, ...own && { own } }
}

async function behind(ws: string): Promise<boolean> {
  const account = keyStore.current()?.account
  const found = roomKeys.room(ws)
  const body = roomKeys.members(ws)
  const kit = ws === account?.workspace.id ? body?.members.find((member) => member.email === account.email)?.kit : undefined
  return Boolean(account && found && body && (keyVersionOf(body) > found.workspace.version || (kit && account.key && kit !== await keysService.accountDeviceKey())))
}

async function listKit({ ws, call }: { ws: string; call: Call }): Promise<void> {
  const account = keyStore.current()?.account
  const room = roomKeys.room(ws)
  const body = bodyOf(room?.list)
  const kit = await keysService.accountDeviceKey()
  const me = await keysService.deviceKey()
  const mine = body?.members.find((member) => member.email === account?.email)
  const home = roomKeys.members()
  if (!room || !body || !kit || !mine?.devices.includes(me) || ws === account?.workspace.id) return
  if (home?.members.find((member) => member.email === account?.email)?.kit !== kit) return
  const gone = mine.devices.filter((device) => device !== me && device !== kit && (home.removed.includes(device) || device === mine.kit))
  const adds = !mine.devices.includes(kit)
  if (!adds && !gone.length && mine.kit === kit) return
  const next = withoutDevices({ body: await nextOf({ list: room.list, body, me }), gone })
  const members = next.members.map((member) => member.email === mine.email ? { ...member, devices: adds ? [...member.devices, kit] : member.devices, kit } : member)
  const list = await signList({ signer: await keysService.device(), body: { ...next, members, added: { ...next.added, ...adds && { [kit]: next.at ?? 0 } } } })
  if ((await call({ method: 'PUT', path: '/members', body: list })).status === 200) await roomKeys.advance({ lists: [list], ws })
}

async function welcome({ ws, call, before, after }: { ws: string; call: Call; before: MemberListBody; after: MemberListBody }): Promise<void> {
  const account = keyStore.current()?.account
  const mine = after.members.find((member) => member.email === account?.email)
  if (!mine || mine.role === 'member' || !account?.key) return
  const fresh = after.members.filter((member) => member.email !== account.email && !before.members.some((each) => each.email === member.email)).flatMap((member) => member.devices)
  for (const sent of await roomKeys.welcomeLetters({ ws, devices: fresh })) await call({ method: 'POST', path: '/letters', body: sent })
}

type MetaField = 'name' | 'site'

function metaBind({ ws, field }: { ws: string; field: MetaField }): string {
  return `workspace/${ws}/${field}`
}

function adminRoom({ ws, sentence }: { ws: string; sentence: string }): { room: Room; body: MemberListBody } {
  const room = roomKeys.room(ws)
  const body = bodyOf(room?.list)
  const mine = roomKeys.roleIn(ws)
  if (!room || !body || !mine || mine === 'member') throw new HttpError(403, sentence)
  return { room, body }
}

function withRoom(current: Stored, room: Room): Stored {
  const account = current.account
  if (!account) return current
  if (room.workspace.id === account.workspace.id) return { ...current, account: { ...account, workspace: room.workspace, list: room.list, first: room.first ?? account.first } }
  return { ...current, account: { ...account, teams: [...(account.teams ?? []).filter((each) => each.workspace.id !== room.workspace.id), room] } }
}

export async function inviteId(key: Bytes): Promise<string> {
  return `inv_${toBase64(await sha256(key)).slice(0, 22)}`
}
