import { check, concat, field, fromBase64, sha256, sign, toBase64, type Bytes, type Identity } from '../vault/public.ts'
import type { Collection, PutSealed, SealedRow } from './wire.ts'

export const KEY_USES = ['workspace', 'own', 'vault'] as const
export type KeyUse = (typeof KEY_USES)[number]
export type Keyring = { version: number; keys: Record<number, Bytes> }
export type Keys = (input: { use: KeyUse; workspace: string }) => Keyring | null | undefined
export type Signer = { key: string; sign: (bytes: Bytes) => Promise<Bytes> }
export type Value = Partial<Record<KeyUse, unknown>>
export type Where = { collection: Collection; workspace: string; parent: string | null; id: string }
export type Opened = Omit<SealedRow, 'sig' | 'body' | 'updatedAt'> & { sealedWith: KeyUse[]; value: Value }
export type Part = { use: KeyUse; locked: Bytes }

const LABEL = new TextEncoder().encode('openhut/sealed\0')
const text = new TextEncoder()
const SMALL = 64 << 10
const MIN_BUCKET = 1024
const PART_HEAD = 5

export function padded({ json, size }: { json: string; size?: number }): Bytes | null {
  const bytes = text.encode(json)
  const target = size ?? (bytes.length > SMALL ? bytes.length : Math.max(MIN_BUCKET, 2 ** Math.ceil(Math.log2(bytes.length))))
  if (bytes.length > target) return null
  const out = new Uint8Array(target).fill(0x20)
  out.set(bytes)
  return out
}

export function signer(identity: Identity): Signer {
  return { key: toBase64(identity.publicKey), sign: (bytes) => sign({ secret: identity.secret, bytes }) }
}

export function whereOf(row: { object: Collection; workspace: string; parent: string | null; id: string }): Where {
  return { collection: row.object, workspace: row.workspace, parent: row.parent, id: row.id }
}

export function context({ where, ver }: { where: Where; ver: number }): string {
  return JSON.stringify([where.collection, where.workspace, where.id, ver, where.parent])
}

export async function signedBytes({ where, ver, body }: { where: Where; ver: number; body: Bytes }): Promise<Bytes> {
  return concat([LABEL, field(context({ where, ver })), await sha256(body)])
}

export async function verify(row: SealedRow): Promise<boolean> {
  const body = fromBase64(row.body)
  if (row.deleted !== (body.length === 0) || !partsOf(body)) return false
  return check({ publicKey: fromBase64(row.by), bytes: await signedBytes({ where: whereOf(row), ver: row.ver, body }), signature: fromBase64(row.sig) })
}

export function sealedWith(body: string): KeyUse[] | null {
  return partsOf(fromBase64(body))?.map((part) => part.use) ?? null
}

export function partsOf(body: Bytes): Part[] | null {
  const parts: Part[] = []
  let at = 0
  while (at < body.length) {
    const tag = body[at]
    const length = at + PART_HEAD <= body.length ? new DataView(body.buffer, body.byteOffset + at + 1, 4).getUint32(0) : Infinity
    const end = at + PART_HEAD + length
    const previous = parts.at(-1)
    if (!KEY_USES[tag] || end > body.length || (previous && KEY_USES.indexOf(previous.use) >= tag)) return null
    parts.push({ use: KEY_USES[tag], locked: body.slice(at + PART_HEAD, end) })
    at = end
  }
  return parts
}

export function u32(value: number): Bytes {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value)
  return out
}
