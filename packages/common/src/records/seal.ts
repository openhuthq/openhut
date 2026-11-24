import { parseJson } from '../cloud/cloud.ts'
import { concat, fromBase64, toBase64, type Bytes } from '../vault/public.ts'
import { lock, unlock } from '../vault/secret.ts'
import { context, KEY_USES, padded, partsOf, signedBytes, u32, verify, whereOf, type Keys, type Opened, type Signer, type Value, type Where } from './row.ts'
import type { PutSealed, SealedRow } from './wire.ts'

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
