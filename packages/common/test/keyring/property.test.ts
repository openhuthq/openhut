import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemberListBody, type MemberList } from '../../src/cloud/cloud.ts'
import { anchorOf, check, signList } from '../../src/cloud/member-list.ts'
import { signer, type Keys, type Where } from '../../src/records/row.ts'
import { open, seal } from '../../src/records/seal.ts'
import { fromBase64, identity, newKey, toBase64, type Bytes } from '../../src/vault/public.ts'
import { letter, lock, read, unlock } from '../../src/vault/secret.ts'

const CASES = Number(process.env.PROPERTY_CASES ?? 300)
let seed = Number(process.env.PROPERTY_SEED ?? 0x5eed)
const random = (below: number): number => {
  seed = (seed * 1103515245 + 12345) >>> 0
  return seed % below
}
const flip = (bytes: Uint8Array): Bytes => {
  const out = Uint8Array.from(bytes)
  out[random(out.length)] ^= 1 << random(8)
  return out
}

test(`locked bytes: ${CASES} random bit flips and relabels never unlock`, async () => {
  const key = newKey()
  const plain = new TextEncoder().encode('a secret worth keeping')
  const locked = await lock({ key, version: 1, bind: 'team/a/record/1', plain })
  assert.ok(locked)
  assert.deepEqual(await unlock({ keys: { 1: key }, bind: 'team/a/record/1', locked }), plain)
  for (let i = 0; i < CASES; i++) {
    assert.equal(await unlock({ keys: { 1: key }, bind: 'team/a/record/1', locked: flip(locked) }), null)
    assert.equal(await unlock({ keys: { 1: key }, bind: `team/a/record/${2 + random(1000)}`, locked }), null)
  }
})

test(`letters: ${CASES} random bit flips never open, and only the named sender is believed`, async () => {
  const [sender, recipient, other] = await Promise.all([identity(), identity(), identity()])
  const body = await letter({ sender, to: recipient.publicKey, workspace: 'TeamWorld01', purpose: 'workspace-key', version: 1, plain: newKey() })
  assert.ok(body)
  const opens = (input: { body: Bytes; from?: Bytes; workspace?: string }) => read({ recipient, from: input.from ?? sender.publicKey, workspace: input.workspace ?? 'TeamWorld01', purpose: 'workspace-key', body: input.body, allowed: [input.from ?? sender.publicKey] })
  assert.ok(await opens({ body }))
  assert.equal(await opens({ body, from: other.publicKey }), null)
  assert.equal(await opens({ body, workspace: 'TeamWorld02' }), null)
  for (let i = 0; i < CASES; i++) assert.equal(await opens({ body: flip(body) }), null)
})

test(`sealed records: ${CASES} random flips of the body, signature or location never open`, async () => {
  const device = await identity()
  const ring = { version: 1, keys: { 1: newKey() } }
  const keys: Keys = ({ use }) => (use === 'workspace' ? ring : null)
  const where: Where = { collection: 'agent', workspace: 'TeamWorld01', parent: 'mo@example.com', id: 'ag_property1' }
  const row = await seal({ where, ver: 3, value: { workspace: { name: 'Juniper' } }, keys, signer: signer(device) })
  assert.ok(row)
  const full = { id: where.id, object: where.collection, ...row }
  assert.ok(await open({ row: full, keys }))
  const fields = ['body', 'sig', 'id', 'workspace', 'parent', 'ver'] as const
  for (let i = 0; i < CASES; i++) {
    const field = fields[random(fields.length)]
    const changed = { ...full }
    if (field === 'body' || field === 'sig') changed[field] = toBase64(flip(fromBase64(full[field])))
    if (field === 'id') changed.id = `ag_property${2 + random(1000)}`
    if (field === 'workspace') changed.workspace = `TeamWorld${10 + random(80)}`
    if (field === 'parent') changed.parent = `x${random(1000)}@example.com`
    if (field === 'ver') changed.ver = 4 + random(1000)
    assert.equal(await open({ row: changed, keys }), null, `a changed ${field} opened`)
  }
})

test(`member-list chains: ${CASES} random edits never verify`, async () => {
  const owner = await identity()
  const stranger = await identity()
  const me = toBase64(owner.publicKey)
  const at = Date.now()
  const v1 = await signList({ signer: owner, body: { workspace: 'TeamWorld01', version: 1, previous: null, members: [{ email: 'mo@example.com', role: 'owner', devices: [me], viewers: [] }], invites: [], removed: [], at, added: { [me]: at } } })
  const v2 = await signList({ signer: owner, body: { workspace: 'TeamWorld01', version: 2, previous: await anchorOf(v1), members: [{ email: 'mo@example.com', role: 'owner', devices: [me], viewers: [] }], invites: [], removed: [], at: at + 1, added: { [me]: at }, keyVersion: 2 } })
  const anchor = await anchorOf(v1)
  assert.ok(await check({ anchor, chain: [v1, v2] }))
  const edits: ((chain: MemberList[]) => Promise<MemberList[]>)[] = [
    async ([a, b]) => [a, { ...b, bytes: toBase64(flip(fromBase64(b.bytes))) }],
    async ([a, b]) => [a, { ...b, signature: toBase64(flip(fromBase64(b.signature))) }],
    async ([a, b]) => [{ ...a, bytes: toBase64(flip(fromBase64(a.bytes))) }, b],
    async ([a, b]) => [b, a],
    async ([a, b]) => [a, b, b],
    async ([a, b]) => [a, { ...b, by: toBase64(stranger.publicKey) }],
    async ([a, b]) => {
      const body = MemberListBody.parse(JSON.parse(new TextDecoder().decode(fromBase64(b.bytes))))
      return [a, await signList({ signer: stranger, body: { ...body, version: body.version + random(3) } })]
    },
  ]
  for (let i = 0; i < CASES; i++) assert.equal(await check({ anchor, chain: await edits[random(edits.length)]([v1, v2]) }), null)
})
