import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Here, KeyBox, Letter, Record, RecordBody } from '../../src/cloud/cloud.ts'
import { identity, lock, newKey, toBase64 } from '../../src/vault/vault.ts'

const locked = toBase64(await lock({ key: newKey(), version: 1, bind: 'record/rec_00000001', plain: new TextEncoder().encode('{}') }))
const record = { id: 'rec_00000001', object: 'record', ver: 1, seq: 0, deleted: false, body: locked }

test('a record with a locked body is accepted', () => {
  assert.equal(Record.safeParse(record).success, true)
})

test('a record whose body is not locked bytes is refused', () => {
  const plain = toBase64(new TextEncoder().encode('{"kind":"agent","value":"hi"}'))
  const unknownSuite = Uint8Array.from(Buffer.from(locked, 'base64url'))
  unknownSuite[1] = 99
  for (const body of [plain, 'not base64!', '', toBase64(unknownSuite), { kind: 'agent' }]) {
    assert.equal(Record.safeParse({ ...record, body }).success, false)
  }
})

test('a record body names one of the closed list of kinds', () => {
  const body = { change: 'chg_00000001', kind: 'instructions', counter: 1, value: 'Answer billing questions.' }
  assert.equal(RecordBody.safeParse(body).success, true)
  assert.equal(RecordBody.safeParse({ ...body, kind: 'grants' }).success, false)
  assert.equal(RecordBody.safeParse({ ...body, kind: '__proto__' }).success, false)
})

test('letters, key boxes and here messages carry locked bodies only', async () => {
  const from = toBase64((await identity()).publicKey)
  const to = toBase64((await identity()).publicKey)
  assert.equal(Letter.safeParse({ id: 'let_00000001', object: 'letter', to, from, workspace: 'ws_00000001', body: locked }).success, true)
  assert.equal(Letter.safeParse({ id: 'let_00000001', object: 'letter', to, from, workspace: 'ws_00000001', body: toBase64(newKey()) }).success, false)
  assert.equal(KeyBox.safeParse({ object: 'key_box', kind: 'kit', body: locked }).success, true)
  assert.equal(Here.safeParse({ object: 'here', from, body: 'aGk' }).success, false)
})
