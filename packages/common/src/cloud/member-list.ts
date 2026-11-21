import { MemberList, MemberListBody, parseJson, type Member } from './cloud.ts'
import { check as checkSignature, concat, fromBase64, sha256, sign, toBase64, type Bytes, type Identity } from '../vault/vault.ts'

type Link = { list: MemberList; body: MemberListBody }

const LABEL = new TextEncoder().encode('openhut/member-list\0')

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
  if (!wellFormed(b) || keyVersionOf(b) < keyVersionOf(a)) return false
  const by = next.list.by
  if (runtimesOf(a).includes(by) || !runtimesOf(a).every((key) => runtimesOf(b).includes(key) || !devicesOf(b).includes(key))) return false
  const invite = a.invites.find((each) => each.key === by)
  const signer = invite ? undefined : a.members.find((member) => member.devices.includes(by))
  if (!tracksRemoved({ previous: a, next: b, owner: signer?.role === 'owner' })) return false
  if (signer?.role !== 'owner' && signer?.role !== 'admin' && keyVersionOf(b) !== keyVersionOf(a)) return false
  if (invite) return joins({ previous: a, next: b, invite })
  if (!signer) return false
  if (signer.role === 'owner') return true
  if (signer.role === 'admin') return same(ownerOf(a), ownerOf(b))
  return changesOnlySelf({ previous: a, next: b, signer })
}

function joins({ previous, next, invite }: { previous: MemberListBody; next: MemberListBody; invite: MemberListBody['invites'][number] }): boolean {
  const joined = next.members.find((member) => member.email === invite.email)
  if (!joined || previous.members.some((member) => member.email === invite.email)) return false
  if (joined.role !== invite.role || joined.devices.length !== 1 || half(joined.devices[0]) === half(invite.key)) return false
  const others = next.members.filter((member) => member !== joined)
  return same(others, previous.members) && same(next.invites, previous.invites.filter((each) => each !== invite))
}

function changesOnlySelf({ previous, next, signer }: { previous: MemberListBody; next: MemberListBody; signer: Member }): boolean {
  const others = (body: MemberListBody) => body.members.filter((member) => member.email !== signer.email)
  const self = next.members.find((member) => member.email === signer.email)
  if (self && self.role !== signer.role) return false
  return same(others(previous), others(next)) && same(previous.invites, next.invites)
}

function tracksRemoved({ previous, next, owner }: { previous: MemberListBody; next: MemberListBody; owner: boolean }): boolean {
  const dropped = (keysOf: (body: MemberListBody) => string[]) => keysOf(previous).filter((key) => !keysOf(next).includes(key))
  const gone = [...dropped(devicesOf), ...dropped((body) => body.invites.map((each) => each.key))]
  const allowed = new Set([...previous.removed, ...gone])
  const removed = new Set(next.removed)
  if (!gone.every((key) => removed.has(key)) || !next.removed.every((key) => allowed.has(key))) return false
  return owner || removed.size === allowed.size
}

function wellFormed(body: MemberListBody): boolean {
  const keys = [...devicesOf(body), ...body.invites.map((each) => each.key), ...body.removed].map(half)
  const owners = body.members.filter((member) => member.role === 'owner')
  return owners.length === 1 && unique(body.members.map((member) => member.email)) && unique(keys) && runtimesOf(body).every((key) => devicesOf(body).includes(key))
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
