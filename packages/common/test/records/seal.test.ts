import { test } from 'node:test'
import assert from 'node:assert/strict'
import { open, seal } from '../../src/records/seal.ts'
import { sealedWith, signedBytes, verify, type Keys, type Value, type Where } from '../../src/records/row.ts'
import type { SealedRow } from '../../src/records/wire.ts'
import { fromBase64, toBase64 } from '../../src/vault/public.ts'
import { agentWhere, devices, keysOf, signerOf, team, teamKeys, type Device } from './world.ts'

const message: Where = { collection: 'message', workspace: team, parent: 'ag_shared1', id: 'msg_0000001' }

async function sealed({ where = message, ver = 1, value = { workspace: { text: 'Refund order 42' } } as Value | null, by = 'moMac' as Device, keys = keysOf('moMac') }: { where?: Where; ver?: number; value?: Value | null; by?: Device; keys?: Keys } = {}): Promise<SealedRow> {
  const put = await seal({ where, ver, value, keys, signer: signerOf(by) })
  assert.ok(put)
  return { id: where.id, object: where.collection, ...put }
}

test('a workspace-sealed row round-trips and no plaintext reaches the bytes the cloud stores', async () => {
  const row = await sealed()
  const opened = await open({ row, keys: keysOf('anaMac') })
  assert.deepEqual(opened?.value, { workspace: { text: 'Refund order 42' } })
  assert.deepEqual(opened?.sealedWith, ['workspace'])
  assert.equal(Buffer.from(fromBase64(row.body)).includes('Refund'), false)
})

test('a row sealed with an older workspace key still opens after rotation', async () => {
  const before = await sealed({ keys: () => ({ version: 1, keys: { 1: teamKeys.keys[1] } }) })
  assert.deepEqual((await open({ row: before, keys: keysOf('anaMac') }))?.value, { workspace: { text: 'Refund order 42' } })
})

test('own opens on every device of its person, phones included, and on no one else’s', async () => {
  const row = await sealed({ where: agentWhere('ag_private'), value: { own: { name: 'Diary' } } })
  assert.deepEqual((await open({ row, keys: keysOf('moPhone') }))?.value, { own: { name: 'Diary' } })
  assert.deepEqual((await open({ row, keys: keysOf('anaMac') }))?.value, {})
  assert.deepEqual(sealedWith(row.body), ['own'])
})

test('a connection is two parts: phones read its name and kind, only Macs and servers read the secret', async () => {
  const where: Where = { collection: 'connection', workspace: team, parent: null, id: 'cn_gmail001' }
  const value = { own: { name: 'Work Gmail', kind: 'gmail' }, vault: { refreshToken: 'r1' } }
  const row = await sealed({ where, value, keys: keysOf('moServer'), by: 'moServer' })
  assert.deepEqual((await open({ row, keys: keysOf('moMac') }))?.value, value)
  assert.deepEqual((await open({ row, keys: keysOf('moPhone') }))?.value, { own: value.own })
  assert.deepEqual((await open({ row, keys: keysOf('anaMac') }))?.value, {})
  assert.equal(await seal({ where, ver: 1, value, keys: keysOf('moPhone'), signer: signerOf('moPhone') }), null)
})

test('a tampered body, a relabelled row or a wrong signer fails the signature', async () => {
  const row = await sealed()
  const body = fromBase64(row.body)
  body[body.length - 1] ^= 1
  const changed: Partial<SealedRow>[] = [
    { body: toBase64(body) },
    { object: 'memory' },
    { workspace: 'ws_other_001' },
    { id: 'msg_0000002' },
    { parent: 'ag_other01' },
    { ver: 2 },
    { by: toBase64(devices.anaMac.publicKey) },
    { deleted: true },
  ]
  assert.equal(await verify(row), true)
  for (const change of changed) assert.equal(await open({ row: { ...row, ...change }, keys: keysOf('moMac') }), null, JSON.stringify(Object.keys(change)))
})

test('ciphertext re-signed under another row by a listed device still won’t open: the label is its associated data', async () => {
  const row = await sealed()
  const moved: Where = { ...message, id: 'msg_0000009' }
  const sig = await signerOf('anaMac').sign(await signedBytes({ where: moved, ver: 1, body: fromBase64(row.body) }))
  const forged = { ...row, id: moved.id, by: signerOf('anaMac').key, sig: toBase64(sig) }
  assert.equal(await verify(forged), true)
  assert.deepEqual((await open({ row: forged, keys: keysOf('moMac') }))?.value, {})
})

test('a tombstone is an empty signed body', async () => {
  const row = await sealed({ ver: 2, value: null })
  assert.equal(row.body, '')
  assert.equal(row.deleted, true)
  assert.deepEqual((await open({ row, keys: keysOf('moMac') }))?.value, {})
  assert.equal(await open({ row: { ...row, deleted: false }, keys: keysOf('moMac') }), null)
})

test('sealing refuses a missing key or an empty value', async () => {
  assert.equal(await seal({ where: message, ver: 1, value: { workspace: 'x' }, keys: () => null, signer: signerOf('moMac') }), null)
  assert.equal(await seal({ where: message, ver: 1, value: {}, keys: keysOf('moMac'), signer: signerOf('moMac') }), null)
})
