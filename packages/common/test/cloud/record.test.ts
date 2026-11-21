import { test } from 'node:test'
import assert from 'node:assert/strict'
import { openRecord, sealRecord, type AgentValue, type Synced } from '../../src/cloud/record.ts'
import type { Member, Record } from '../../src/cloud/cloud.ts'
import { identity, newKey, toBase64 } from '../../src/vault/vault.ts'

const workspace = 'ws_record_test'
const key = newKey()
const mo = await identity()
const ana = await identity()
const stranger = await identity()
const members: Member[] = [{ email: 'mo@example.com', role: 'owner', devices: [toBase64(mo.publicKey)] }, { email: 'ana@example.com', role: 'member', devices: [toBase64(ana.publicKey)] }]
const helpdesk: AgentValue = { id: 'ag_helpdesk', name: 'Helpdesk', instructions: 'Answer billing questions.', model: 'claude:sonnet', face: null, codeExecution: true, wanted: 'running' }

async function sealed({ id = 'rec_00000001', ver = 1, kind = 'agent', ref = helpdesk.id, value = helpdesk as unknown, signer = mo, version = 1 }: { id?: string; ver?: number; kind?: Synced; ref?: string; value?: unknown; signer?: typeof mo; version?: number } = {}): Promise<Record> {
  const made = await sealRecord({ workspace, key, version, signer, id, ver, kind, ref, value })
  assert.ok(made)
  return { id, object: 'record', seq: 1, ...made }
}
const open = (record: Record) => openRecord({ workspace, keys: { 1: key }, record, members })

test('an agent record round-trips, and its name is in no byte the room stores', async () => {
  const record = await sealed()
  assert.deepEqual(await open(record), { kind: 'agent', ref: helpdesk.id, value: helpdesk, by: toBase64(mo.publicKey) })
  assert.equal(JSON.stringify(record).includes('Helpdesk'), false)
  assert.equal(Buffer.from(record.body, 'base64url').includes('Helpdesk'), false)
})

test('only the closed list of fields applies: grants and sandbox are dropped, unknown kinds refused', async () => {
  const opened = await open(await sealed({ value: { ...helpdesk, grants: ['Orders DB'], sandbox: 'none', net: 7 } }))
  assert.deepEqual(opened?.value, helpdesk)
  assert.equal(await open(await sealed({ kind: 'grants' as Synced })), null)
  assert.equal(await open(await sealed({ value: { ...helpdesk, model: 'evil' } })), null)
  assert.equal(await open(await sealed({ ref: 'ag_someother' })), null)
})

test('changes from devices not on the list, and admin-only kinds from members, are dropped', async () => {
  assert.equal(await open(await sealed({ signer: stranger })), null)
  assert.notEqual(await open(await sealed({ signer: ana })), null)
  const setting = { kind: 'setting' as const, ref: 'time_zone', value: { name: 'time_zone', value: 'Europe/Lisbon' } }
  assert.equal(await open(await sealed({ ...setting, signer: ana })), null)
  assert.equal((await open(await sealed(setting)))?.ref, 'time_zone')
})

test('a room that swaps, replays or lies about a record is caught', async () => {
  const one = await sealed({ id: 'rec_00000001' })
  const two = await sealed({ id: 'rec_00000002' })
  assert.equal(await open({ ...two, body: one.body }), null)
  assert.equal(await open({ ...one, ver: 2 }), null)
  assert.equal(await open({ ...one, deleted: true }), null)
  const tombstone = await sealed({ ver: 2, value: null })
  assert.deepEqual(await open(tombstone), { kind: 'agent', ref: helpdesk.id, value: null, by: toBase64(mo.publicKey) })
  assert.equal(await open({ ...tombstone, deleted: false }), null)
  assert.equal(await open(await sealed({ version: 2 })), null)
})

test('a connection key travels only sealed to device keys, never plain', async () => {
  const connection = { id: 'con_orders01', kind: 'postgres', name: 'Orders DB', keys: [{ to: toBase64(mo.publicKey), body: 'postgres://user:secret@db' }] }
  assert.equal(await open(await sealed({ kind: 'connection', ref: connection.id, value: connection })), null)
  const letter = (await sealed()).body
  const opened = await open(await sealed({ kind: 'connection', ref: connection.id, value: { ...connection, keys: [{ to: toBase64(mo.publicKey), body: letter }] } }))
  assert.equal(opened?.kind, 'connection')
})
