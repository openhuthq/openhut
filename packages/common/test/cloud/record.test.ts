import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lockHere, openHere, openRecord, sealRecord, type AgentValue, type Synced } from '../../src/cloud/record.ts'
import { recordBind, signRecord, type Member, type Record } from '../../src/cloud/cloud.ts'
import { identity, lock, newKey, toBase64 } from '../../src/vault/vault.ts'

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
async function forged({ id = 'rec_00000001', kind = 'agent', ref = helpdesk.id, value = helpdesk as unknown }: { id?: string; kind?: Synced; ref?: string; value?: unknown }): Promise<Record> {
  const bytes = new TextEncoder().encode(JSON.stringify({ change: toBase64(newKey(12)), kind, counter: 1, ref, value }))
  const signed = await signRecord({ signer: mo, bind: recordBind({ workspace, id, kind: kind as 'agent' }), bytes })
  const locked = await lock({ key, version: 1, bind: `workspace/${workspace}/record/${id}`, plain: new TextEncoder().encode(JSON.stringify(signed)) })
  assert.ok(locked)
  return { id, object: 'record', seq: 1, ver: 1, deleted: false, body: toBase64(locked) }
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
  assert.equal(await open(await forged({ kind: 'grants' as Synced })), null)
  assert.equal(await open(await forged({ value: { ...helpdesk, model: 'evil' } })), null)
  assert.equal(await open(await forged({ ref: 'ag_someother' })), null)
})

test('sealing refuses a value outside the schema, so nothing is backed up that a restore would drop', async () => {
  const seal = (value: unknown, ref = helpdesk.id) => sealRecord({ workspace, key, version: 1, signer: mo, id: 'rec_00000001', ver: 1, kind: 'agent', ref, value })
  assert.equal(await seal({ ...helpdesk, name: 'x'.repeat(41) }), null)
  assert.equal(await seal({ ...helpdesk, instructions: 'x'.repeat(20_001) }), null)
  assert.equal(await seal(helpdesk, 'ag_someother'), null)
  assert.ok(await seal({ ...helpdesk, name: 'x'.repeat(40) }))
  assert.ok(await seal(null))
})

test('a head lists the latest version of every record and round-trips', async () => {
  const value = { records: [['rec_00000001', 3], ['rec_00000002', 1]] }
  assert.deepEqual((await open(await sealed({ kind: 'head', ref: 'head', value })))?.value, value)
  assert.equal(await sealRecord({ workspace, key, version: 1, signer: mo, id: 'rec_00000009', ver: 1, kind: 'head', ref: 'other', value }), null)
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
  const connection = { id: 'cn_orders01', kind: 'postgres', name: 'Orders DB', account: 'db · orders', signIn: false, keys: [{ to: toBase64(mo.publicKey), body: 'postgres://user:secret@db' }] }
  assert.equal(await open(await forged({ kind: 'connection', ref: connection.id, value: connection })), null)
  const letter = (await sealed()).body
  const opened = await open(await sealed({ kind: 'connection', ref: connection.id, value: { ...connection, keys: [{ to: toBase64(mo.publicKey), body: letter }] } }))
  assert.equal(opened?.kind, 'connection')
})

test('a synced face is a look or a raster picture, never SVG or HTML', async () => {
  const face = async (value: string) => (await open(await sealed({ value: { ...helpdesk, face: value } })))?.value
  assert.notEqual(await face('data:image/png;base64,iVBORw0KGgo='), undefined)
  assert.notEqual(await face('{"seed":"x"}'), undefined)
  assert.equal(await open(await forged({ value: { ...helpdesk, face: 'data:image/svg+xml;base64,PHN2Zz4=' } })), null)
  assert.equal(await open(await forged({ value: { ...helpdesk, face: '<img src=x onerror=alert(1)>' } })), null)
})

test('messages, memory and files are closed kinds too: a file path can’t leave the agent’s home', async () => {
  const message = { agentId: helpdesk.id, message: { id: 'msg_1', role: 'assistant', parts: [{ type: 'text', text: 'Hi' }] } }
  assert.deepEqual((await open(await sealed({ kind: 'message', ref: 'msg_1', value: message })))?.value, message)
  const file = { agentId: helpdesk.id, path: 'uploads/report.csv', size: 3, sha: 'a'.repeat(43), blob: 'b'.repeat(43) }
  assert.deepEqual((await open(await sealed({ kind: 'file', ref: `${helpdesk.id}/${file.path}`, value: file })))?.value, file)
  assert.equal(await open(await forged({ kind: 'file', ref: `${helpdesk.id}/../../etc/passwd`, value: { ...file, path: '../../etc/passwd' } })), null)
  assert.equal(await open(await forged({ kind: 'memory', ref: helpdesk.id, value: { agentId: helpdesk.id, notes: 'x'.repeat(20_000), people: null } })), null)
})

test('small records are padded to a size bucket, so a one-letter edit is the same size on the wire', async () => {
  const short = await sealed({ value: { ...helpdesk, name: 'A' } })
  const long = await sealed({ value: { ...helpdesk, name: 'A much longer name for it' } })
  assert.equal(short.body.length, long.body.length)
  assert.deepEqual((await open(long))?.value, { ...helpdesk, name: 'A much longer name for it' })
})

test('a Here is locked to its sender, padded to one fixed size, and opens only with the workspace key', async () => {
  const from = toBase64(mo.publicKey)
  const value = { agent: 'ag_helpdesk', field: 'instructions' as const, typing: false, at: 1, seq: 7, log: 'x'.repeat(43), list: 3, listHash: 'y'.repeat(43) }
  const idle = { ...value, agent: null, field: null, seq: 123456, list: 999 }
  const body = await lockHere({ workspace, key, version: 1, from, value })
  const other = await lockHere({ workspace, key, version: 1, from, value: idle })
  assert.ok(body && other)
  assert.equal(body.length, other.length)
  assert.deepEqual(await openHere({ workspace, keys: { 1: key }, from, body }), value)
  assert.equal(await openHere({ workspace, keys: { 1: key }, from: toBase64(ana.publicKey), body }), null)
  assert.equal(await openHere({ workspace, keys: { 1: newKey() }, from, body }), null)
  assert.equal(Buffer.from(body, 'base64url').includes('ag_helpdesk'), false)
  assert.equal(await lockHere({ workspace, key, version: 1, from, value: { ...value, agent: 'ag_x'.repeat(200) } }), null)
})
