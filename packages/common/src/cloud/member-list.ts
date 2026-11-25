import { MemberList, MemberListBody, parseJson, type Member } from './cloud.ts'
import { check as checkSignature, concat, fromBase64, sha256, sign, toBase64, type Bytes, type Identity } from '../vault/public.ts'

type Link = { list: MemberList; body: MemberListBody }

const KEEP_REMOVED = 1000

const LABEL = new TextEncoder().encode('openhut/member-list\0')
export const YOUNG_MS = 0

export async function signList({ signer, body }: { signer: Identity; body: MemberListBody }): Promise<MemberList> {
  const bytes = new TextEncoder().encode(JSON.stringify(MemberListBody.safeParse(body).data ?? body))
  const signature = await sign({ secret: signer.secret, bytes: labelled(bytes) })
  return { object: 'member_list', bytes: toBase64(bytes), by: toBase64(signer.publicKey), signature: toBase64(signature) }
}

export async function anchorOf(list: MemberList): Promise<string> {
  return toBase64(await sha256(fromBase64(list.bytes)))
}

export async function check({ anchor, chain }: { anchor: string; chain: MemberList[] }): Promise<MemberListBody | null> {
  if (chain.length === 0) return null
  let previous = await open(chain[0])
  if (!previous || !wellFormed(previous.body) || (previous.body.previous === null && previous.body.removed.length > 0) || (await anchorOf(chain[0])) !== anchor) return null
  for (const list of chain.slice(1)) {
    const next = await open(list)
    if (!next || !(await follows({ previous, next }))) return null
    previous = next
  }
  return previous.body
}

export function bodyOf(list: MemberList | undefined): MemberListBody | undefined {
  return list && MemberListBody.safeParse(parseJson(new TextDecoder().decode(fromBase64(list.bytes)))).data
}

export function firstOf(room: { list: MemberList; first?: MemberList }): MemberList {
  return room.first ?? room.list
}

export async function nextOf({ list, body, me }: { list: MemberList; body: MemberListBody; me: string }): Promise<MemberListBody> {
  const owner = ownerOf(body)?.devices.includes(me)
  const removed = owner && body.removed.length > KEEP_REMOVED ? body.removed.slice(-KEEP_REMOVED / 2) : body.removed
  return { ...body, version: body.version + 1, previous: await anchorOf(list), at: Math.max(Date.now(), body.at ?? 0), removed }
}

export function withoutDevices({ body, gone }: { body: MemberListBody; gone: string[] }): MemberListBody {
  const kept = <T>(map: Record<string, T> | undefined) => map && Object.fromEntries(Object.entries(map).filter(([device]) => !gone.includes(device)))
  const members = body.members.map((member) => ({ ...member, devices: member.devices.filter((device) => !gone.includes(device)), ...member.viewers && { viewers: member.viewers.filter((device) => !gone.includes(device)) } }))
  return { ...body, members, removed: [...body.removed, ...gone.filter((device) => !body.removed.includes(device))], runtimes: body.runtimes?.filter((device) => !gone.includes(device)), added: kept(body.added), names: kept(body.names) }
}

async function open(list: MemberList): Promise<Link | null> {
  if (!MemberList.safeParse(list).success) return null
  const bytes = fromBase64(list.bytes)
  const signed = await checkSignature({ publicKey: fromBase64(list.by), bytes: labelled(bytes), signature: fromBase64(list.signature) })
  if (!signed) return null
  const text = new TextDecoder().decode(bytes)
  const body = MemberListBody.safeParse(parseJson(text))
  return body.success && JSON.stringify(body.data) === text ? { list, body: body.data } : null
}

function labelled(bytes: Bytes): Bytes {
  return concat([LABEL, bytes])
}

async function follows({ previous, next }: { previous: Link; next: Link }): Promise<boolean> {
  const a = previous.body
  const b = next.body
  if (b.workspace !== a.workspace || b.version !== a.version + 1 || b.previous !== (await anchorOf(previous.list))) return false
  if (!wellFormed(b) || keyVersionOf(b) < keyVersionOf(a) || !dated({ previous: a, next: b })) return false
  const by = next.list.by
  if (runtimesOf(a).includes(by) || !runtimesOf(a).every((key) => runtimesOf(b).includes(key) || !devicesOf(b).includes(key))) return false
  if (viewersOf(a).some((key) => devicesOf(b).includes(key))) return false
  const invite = a.invites.find((each) => each.key === by)
  const signer = invite ? undefined : a.members.find((member) => member.devices.includes(by))
  const back = invite ? b.members.find((member) => member.email === invite.email)?.devices.find((key) => a.removed.includes(key)) : undefined
  if (managedOf(b) !== managedOf(a) && signer?.role !== 'owner') return false
  if (!tracksRemoved({ previous: a, next: b, owner: signer?.role === 'owner', back })) return false
  const manager = signer?.role === 'owner' || signer?.role === 'admin'
  if (!manager && (keyVersionOf(b) !== keyVersionOf(a) || runtimesOf(b).some((key) => !runtimesOf(a).includes(key)))) return false
  if (signersOf(b).length === 0) return false
  if (invite) return joins({ previous: a, next: b, invite })
  if (managedOf(a) === by) return managedAdds({ previous: a, next: b })
  if (!signer) return false
  if (signer.kit === by) return kitAdds({ previous: a, next: b, signer })
  if (signer.role === 'owner') return true
  if (signer.role === 'admin') return same(ownerOf(a), ownerOf(b))
  return changesOnlySelf({ previous: a, next: b, signer })
}

function joins({ previous, next, invite }: { previous: MemberListBody; next: MemberListBody; invite: MemberListBody['invites'][number] }): boolean {
  const joined = next.members.find((member) => member.email === invite.email)
  if (!joined || previous.members.some((member) => member.email === invite.email)) return false
  if (joined.role !== invite.role || joined.devices.length !== 1 || joined.viewers?.length || half(joined.devices[0]) === half(invite.key)) return false
  const others = next.members.filter((member) => member !== joined)
  return same(others, previous.members) && same(next.invites, previous.invites.filter((each) => each !== invite))
}

function managedAdds({ previous: a, next: b }: { previous: MemberListBody; next: MemberListBody }): boolean {
  const kept = a.members.every((was) => {
    const now = b.members.find((member) => member.email === was.email)
    return now && now.role === was.role && now.kit === was.kit && same(now.viewers, was.viewers) && was.devices.every((key, at) => now.devices[at] === key)
  })
  const joined = b.members.filter((member) => !a.members.some((was) => was.email === member.email))
  const used = a.invites.filter((each) => joined.some((member) => member.email === each.email && member.role === each.role))
  return kept && used.length === joined.length && same(b.invites, a.invites.filter((each) => !used.includes(each))) && same(b.runtimes, a.runtimes)
}

export function managedOf(body: MemberListBody): string | undefined {
  return body.managed
}

function dated({ previous: a, next: b }: { previous: MemberListBody; next: MemberListBody }): boolean {
  if (a.at !== undefined && (b.at === undefined || b.at < a.at)) return false
  const fresh = listedOf(b).filter((key) => !listedOf(a).includes(key))
  const kept = listedOf(a).filter((key) => listedOf(b).includes(key))
  return kept.every((key) => addedOf(b, key) === addedOf(a, key) && b.names?.[key] === a.names?.[key]) && fresh.every((key) => b.added?.[key] === b.at)
}

export function newUntil(body: MemberListBody, key: string): number {
  const since = addedOf(body, key)
  return since > 0 && devicesOf(body).some((each) => addedOf(body, each) < since) ? since + YOUNG_MS : 0
}

function kitAdds({ previous: a, next: b, signer }: { previous: MemberListBody; next: MemberListBody; signer: Member }): boolean {
  const fresh = b.members.find((member) => member.email === signer.email)?.devices.filter((key) => !signer.devices.includes(key)) ?? []
  return fresh.length === 1 && b.removed.length === a.removed.length && onlyDevices({ previous: a, next: b, signer, devices: [...signer.devices, ...fresh] })
}

function onlyDevices({ previous: a, next: b, signer, devices }: { previous: MemberListBody; next: MemberListBody; signer: Member; devices: string[] }): boolean {
  const expected = { ...a, members: a.members.map((member) => member === signer ? { ...member, devices } : member), removed: b.removed }
  const rest = ({ version: _v, previous: _p, at: _at, added: _added, names: _names, ...body }: MemberListBody) => body
  return same(rest(expected), rest(b))
}

export function addedOf(body: MemberListBody, key: string): number {
  return body.added?.[key] ?? 0
}

function changesOnlySelf({ previous, next, signer }: { previous: MemberListBody; next: MemberListBody; signer: Member }): boolean {
  const others = (body: MemberListBody) => body.members.filter((member) => member.email !== signer.email)
  const self = next.members.find((member) => member.email === signer.email)
  if (self && self.role !== signer.role) return false
  return same(others(previous), others(next)) && same(previous.invites, next.invites)
}

function tracksRemoved({ previous, next, owner, back }: { previous: MemberListBody; next: MemberListBody; owner: boolean; back?: string }): boolean {
  const dropped = (keysOf: (body: MemberListBody) => string[]) => keysOf(previous).filter((key) => !keysOf(next).includes(key))
  const gone = [...dropped(listedOf), ...dropped((body) => body.invites.map((each) => each.key))]
  const allowed = new Set([...previous.removed, ...gone].filter((key) => key !== back))
  const removed = new Set(next.removed)
  if (!gone.every((key) => removed.has(key)) || !next.removed.every((key) => allowed.has(key))) return false
  return owner || removed.size === allowed.size
}

function wellFormed(body: MemberListBody): boolean {
  const keys = [...listedOf(body), ...body.invites.map((each) => each.key), ...body.removed, ...body.managed ? [body.managed] : []].map(half)
  const owners = body.members.filter((member) => member.role === 'owner')
  const kits = body.members.every((member) => !member.kit || member.devices.includes(member.kit))
  const added = [...Object.keys(body.added ?? {}), ...Object.keys(body.names ?? {})].every((key) => listedOf(body).includes(key))
  return owners.length === 1 && kits && added && unique(body.members.map((member) => member.email)) && unique(keys) && runtimesOf(body).every((key) => devicesOf(body).includes(key))
}

function signersOf(body: MemberListBody): string[] {
  return body.members.filter((member) => member.role === 'owner' || member.role === 'admin').flatMap((member) => member.devices).filter((key) => !runtimesOf(body).includes(key))
}

function runtimesOf(body: MemberListBody): string[] {
  return body.runtimes ?? []
}

export function keyVersionOf(body: MemberListBody): number {
  return body.keyVersion ?? 1
}

function devicesOf(body: MemberListBody): string[] {
  return body.members.flatMap((member) => member.devices)
}

export function viewersOf(body: MemberListBody): string[] {
  return body.members.flatMap((member) => member.viewers ?? [])
}

export function listedOf(body: MemberListBody): string[] {
  return [...devicesOf(body), ...viewersOf(body)]
}

function half(key: string): string {
  return toBase64(fromBase64(key).subarray(0, 32))
}

function unique(values: string[]): boolean {
  return new Set(values).size === values.length
}

function ownerOf(body: MemberListBody): Member | undefined {
  return body.members.find((member) => member.role === 'owner')
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
