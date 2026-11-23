import { parseJson } from '../cloud/cloud.ts'
import { check, concat, field, fromBase64, lock, sha256, sign, toBase64, unlock, type Bytes, type Identity } from '../vault/vault.ts'
import type { Collection, PutSealed, SealedRow } from './wire.ts'

export const KEY_USES = ['workspace', 'own', 'vault'] as const
export type KeyUse = (typeof KEY_USES)[number]
export type Keyring = { version: number; keys: Record<number, Bytes> }
export type Keys = (input: { use: KeyUse; workspace: string }) => Keyring | null | undefined
export type Signer = { key: string; sign: (bytes: Bytes) => Promise<Bytes> }
export type Value = Partial<Record<KeyUse, unknown>>
export type Where = { collection: Collection; workspace: string; parent: string | null; id: string }
export type Opened = Omit<SealedRow, 'sig' | 'body' | 'updatedAt'> & { sealedWith: KeyUse[]; value: Value }
type Part = { use: KeyUse; locked: Bytes }

const LABEL = new TextEncoder().encode('openhut/sealed\0')
const PART_HEAD = 5
const SMALL = 64 << 10
const MIN_BUCKET = 1024

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

export async function seal({ where, ver, value, keys, signer }: { where: Where; ver: number; value: Value | null; keys: Keys; signer: Signer }): Promise<PutSealed | null> {
  const bind = context({ where, ver })
  const parts: Bytes[] = []
  for (const [tag, use] of KEY_USES.entries()) {
    if (value?.[use] === undefined) continue
    const ring = keys({ use, workspace: where.workspace })
    const key = ring?.keys[ring.version]
    const plain = padded({ json: JSON.stringify(value[use]) })
    const locked = ring && key && plain && await lock({ key, version: ring.version, bind, plain })
    if (!locked) return null
    parts.push(concat([Uint8Array.of(tag), u32(locked.length), locked]))
  }
  if (value && !parts.length) return null
  const body = concat(parts)
  const sig = await signer.sign(await signedBytes({ where, ver, body }))
  return { workspace: where.workspace, parent: where.parent, ver, by: signer.key, sig: toBase64(sig), body: toBase64(body), deleted: value === null }
}

export async function verify(row: SealedRow): Promise<boolean> {
  const body = fromBase64(row.body)
  if (row.deleted !== (body.length === 0) || !partsOf(body)) return false
  return check({ publicKey: fromBase64(row.by), bytes: await signedBytes({ where: whereOf(row), ver: row.ver, body }), signature: fromBase64(row.sig) })
}

export async function open({ row, keys }: { row: SealedRow; keys: Keys }): Promise<Opened | null> {
  const parts = await verify(row) ? partsOf(fromBase64(row.body)) : null
  if (!parts) return null
  const bind = context({ where: whereOf(row), ver: row.ver })
  const value: Value = {}
  for (const { use, locked } of parts) {
    const ring = keys({ use, workspace: row.workspace })
    const plain = ring && await unlock({ keys: ring.keys, bind, locked })
    if (plain) value[use] = parseJson(new TextDecoder().decode(plain))
  }
  const { sig: _sig, body: _body, updatedAt: _updatedAt, ...rest } = row
  return { ...rest, sealedWith: parts.map((part) => part.use), value }
}

export function padded({ json, size }: { json: string; size?: number }): Bytes | null {
  const bytes = new TextEncoder().encode(json)
  const target = size ?? (bytes.length > SMALL ? bytes.length : Math.max(MIN_BUCKET, 2 ** Math.ceil(Math.log2(bytes.length))))
  if (bytes.length > target) return null
  const out = new Uint8Array(target).fill(0x20)
  out.set(bytes)
  return out
}

export function sealedWith(body: string): KeyUse[] | null {
  return partsOf(fromBase64(body))?.map((part) => part.use) ?? null
}

function partsOf(body: Bytes): Part[] | null {
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

function u32(value: number): Bytes {
  const out = new Uint8Array(4)
  new DataView(out.buffer).setUint32(0, value)
  return out
}
