import { MemberList, MemberListBody, type Member } from './cloud.ts'
import { check as checkSignature, fromBase64, sha256, sign, toBase64, type Identity } from '../vault/vault.ts'

type Link = { list: MemberList; body: MemberListBody }

export async function signList({ signer, body }: { signer: Identity; body: MemberListBody }): Promise<MemberList> {
  const bytes = new TextEncoder().encode(JSON.stringify(body))
  const signature = await sign({ secret: signer.secret, bytes })
  return { object: 'member_list', bytes: toBase64(bytes), by: toBase64(signer.publicKey), signature: toBase64(signature) }
}

export async function anchorOf(list: MemberList): Promise<string> {
  return toBase64(await sha256(fromBase64(list.bytes)))
}

export async function check({ anchor, chain }: { anchor: string; chain: MemberList[] }): Promise<MemberListBody | null> {
  if (chain.length === 0) return null
  let previous = await open(chain[0])
  if (!previous || !wellFormed(previous.body) || (await anchorOf(chain[0])) !== anchor) return null
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
  const signed = await checkSignature({ publicKey: fromBase64(list.by), bytes, signature: fromBase64(list.signature) })
  if (!signed) return null
  const json = parseJson(new TextDecoder().decode(bytes))
  const body = MemberListBody.safeParse(json)
  return body.success ? { list, body: body.data } : null
}

async function follows({ previous, next }: { previous: Link; next: Link }): Promise<boolean> {
  const a = previous.body
  const b = next.body
  if (b.workspace !== a.workspace || b.version !== a.version + 1 || b.previous !== (await anchorOf(previous.list))) return false
  if (!wellFormed(b) || !keepsRemoved({ previous: a, next: b })) return false
  const by = next.list.by
  const invite = a.invites.find((each) => each.key === by)
  if (invite) return joins({ previous: a, next: b, invite })
  const signer = a.members.find((member) => member.devices.includes(by))
  if (!signer) return false
  if (signer.role === 'owner') return true
  if (signer.role === 'admin') return same(ownerOf(a), ownerOf(b))
  return changesOnlySelf({ previous: a, next: b, signer })
}

function joins({ previous, next, invite }: { previous: MemberListBody; next: MemberListBody; invite: MemberListBody['invites'][number] }): boolean {
  const joined = next.members.find((member) => member.email === invite.email)
  if (!joined || previous.members.some((member) => member.email === invite.email)) return false
  if (joined.role !== invite.role || joined.devices.length !== 1) return false
  const others = next.members.filter((member) => member !== joined)
  return same(others, previous.members) && same(next.invites, previous.invites.filter((each) => each !== invite))
}

function changesOnlySelf({ previous, next, signer }: { previous: MemberListBody; next: MemberListBody; signer: Member }): boolean {
  const others = (body: MemberListBody) => body.members.filter((member) => member.email !== signer.email)
  const self = next.members.find((member) => member.email === signer.email)
  if (self && self.role !== signer.role) return false
  return same(others(previous), others(next)) && same(previous.invites, next.invites)
}

function keepsRemoved({ previous, next }: { previous: MemberListBody; next: MemberListBody }): boolean {
  const before = previous.members.flatMap((member) => member.devices)
  const after = new Set(next.members.flatMap((member) => member.devices))
  const removed = new Set(next.removed)
  return previous.removed.every((key) => removed.has(key)) && before.every((key) => after.has(key) || removed.has(key)) && [...after].every((key) => !removed.has(key))
}

function wellFormed(body: MemberListBody): boolean {
  const emails = body.members.map((member) => member.email)
  const devices = body.members.flatMap((member) => member.devices)
  const owners = body.members.filter((member) => member.role === 'owner')
  return owners.length === 1 && new Set(emails).size === emails.length && new Set(devices).size === devices.length
}

function ownerOf(body: MemberListBody): Member | undefined {
  return body.members.find((member) => member.role === 'owner')
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
