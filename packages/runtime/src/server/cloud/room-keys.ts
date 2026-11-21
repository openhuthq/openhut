import * as z from 'zod/mini'
import { Letter, MemberList, MemberListBody, parseJson, type Role } from '@openhut/common/cloud/cloud.ts'
import { anchorOf, check, keyVersionOf, signList } from '@openhut/common/cloud/member-list.ts'
import { fromBase64, identity, letter, sha256, slot, toBase64, type Bytes, type Identity } from '@openhut/common/vault/vault.ts'
import { HttpError } from '../platform/http-error.ts'
import { keyStore, Keys, type Account, type Room, type Stored } from './key-store.ts'
import { accountDevice, keysService, openLetter, sealTo, type Sent } from './keys-service.ts'

const INVITE_MS = 48 * 60 * 60_000
const INVITE_URL = 'https://openhut.dev/join'
const Secret = z.object({ ...Keys.shape, anchor: z.string() })
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
    const key = keyStore.current()?.account?.key
    if (room?.workspace.own) return fromBase64(room.workspace.own)
    return room && key ? fromBase64(await slot({ key: fromBase64(key), path: `own/${room.workspace.id}` })) : null
  },

  async advance({ lists, ws }: { lists: MemberList[]; ws?: string }): Promise<MemberListBody | null> {
    const current = await keyStore.read()
    const room = roomKeys.room(ws)
    if (!current.account || !room || !lists.length) return null
    const body = await check({ anchor: await anchorOf(room.list), chain: [room.list, ...lists] })
    const last = lists.at(-1)
    if (body && last) await keyStore.write(withRoom(current, { ...room, list: last }))
    return body
  },

  async invite({ ws, email, role, name }: { ws: string; email: string; role: 'admin' | 'member'; name: string }): Promise<{ list: MemberList; id: string; key: string; body: string; link: string; expiresAt: string }> {
    const account = keysService.mustBeOn()
    const { room, body } = adminRoom({ ws, sentence: 'Only an owner or admin can invite people.' })
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
    const { room, body } = adminRoom({ ws, sentence: 'Only an owner or admin can change roles.' })
    const target = body.members.find((member) => member.email === email)
    if (!target) throw new HttpError(404, `${email} isn’t in this workspace.`)
    if (target.role === 'owner') throw new HttpError(403, 'The owner stays the owner. Hand the workspace over first.')
    return signList({ signer: await keysService.device(), body: { ...await nextOf({ list: room.list, body }), members: body.members.map((member) => member === target ? { ...member, role } : member) } })
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
    if (!body || !last || !invite || body.workspace !== ws) throw new HttpError(400, 'This invite doesn’t check out. Ask for a new link.')
    const me = await keysService.deviceKey()
    const next = await nextOf({ list: last, body })
    return signList({ signer: card, body: { ...next, members: [...body.members, { email: account.email, role: invite.role, devices: [me] }], invites: body.invites.filter((each) => each !== invite), removed: [...body.removed, invite.key], added: { ...body.added, [me]: next.at ?? 0 } } })
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
        const { anchor: _anchor, ...fresh } = secret
        room = { ...room, workspace: { ...room.workspace, ...fresh } }
      } else if (plain && kit && body.members.find((member) => member.email === account?.email)?.kit === kit) account = { ...account, key: toBase64(plain) }
      else if ((secret && secret.version > keyVersionOf(body)) || (kit && !body.removed.includes(kit))) continue
      done.push(each.id)
    }
    if (done.length) await keyStore.write({ ...withRoom({ ...current, account }, room), kit: account.key === current.account?.key ? current.kit : undefined })
    return done
  },

  async refresh({ ws, call }: { ws: string; call: Call }): Promise<{ changed: boolean; behind: boolean }> {
    const before = roomKeys.members(ws)
    const reply = await call({ method: 'GET', path: `/member-lists?after=${before?.version ?? 0}` })
    const after = await roomKeys.advance({ lists: Lists.safeParse(reply.json).data?.data ?? [], ws })
    if (before && after) await welcome({ ws, call, before, after })
    return { changed: Boolean(after), behind: await roomKeys.rekey({ ws, call }) }
  },

  async rekey({ ws, call }: { ws: string; call: Call }): Promise<boolean> {
    if (!await behind(ws)) return false
    const found = Letters.safeParse((await call({ method: 'GET', path: '/letters' })).json).data?.data ?? []
    for (const id of await roomKeys.takeLetters({ found, ws })) await call({ method: 'DELETE', path: `/letters/${id}` })
    return behind(ws)
  },
}

async function behind(ws: string): Promise<boolean> {
  const account = keyStore.current()?.account
  const found = roomKeys.room(ws)
  const body = roomKeys.members(ws)
  const kit = ws === account?.workspace.id ? body?.members.find((member) => member.email === account.email)?.kit : undefined
  return Boolean(account && found && body && (keyVersionOf(body) > found.workspace.version || (kit && account.key && kit !== await keysService.accountDeviceKey())))
}

async function welcome({ ws, call, before, after }: { ws: string; call: Call; before: MemberListBody; after: MemberListBody }): Promise<void> {
  const account = keyStore.current()?.account
  const mine = after.members.find((member) => member.email === account?.email)
  if (!mine || mine.role === 'member' || !account?.key) return
  const fresh = after.members.filter((member) => member.email !== account.email && !before.members.some((each) => each.email === member.email)).flatMap((member) => member.devices)
  for (const sent of await roomKeys.welcomeLetters({ ws, devices: fresh })) await call({ method: 'POST', path: '/letters', body: sent })
}

function adminRoom({ ws, sentence }: { ws: string; sentence: string }): { room: Room; body: MemberListBody } {
  const room = roomKeys.room(ws)
  const body = bodyOf(room?.list)
  const mine = roomKeys.roleIn(ws)
  if (!room || !body || !mine || mine === 'member') throw new HttpError(403, sentence)
  return { room, body }
}

export async function secretOf({ room, own }: { room: Room; own: boolean }): Promise<Bytes> {
  const { id, own: _own, ...keys } = room.workspace
  const ownKey = own ? await roomKeys.own(id) : null
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

export async function nextOf({ list, body }: { list: MemberList; body: MemberListBody }): Promise<MemberListBody> {
  return { ...body, version: body.version + 1, previous: await anchorOf(list), at: Math.max(Date.now(), body.at ?? 0) }
}

export function firstOf(room: Room): MemberList {
  return room.first ?? room.list
}

export function bodyOf(list: MemberList | undefined): MemberListBody | undefined {
  return list && MemberListBody.safeParse(parseJson(new TextDecoder().decode(fromBase64(list.bytes)))).data
}
