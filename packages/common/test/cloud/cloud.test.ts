import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Base64, checkRecord, DeviceKey, fromQr, Here, KeyBox, Letter, qrPayload, Record, recordBind, RecordKind, Signed, signRecord, siteHost } from '../../src/cloud/cloud.ts'
import { identity, lock, newKey, newPairing, toBase64 } from '../../src/vault/vault.ts'

const locked = toBase64((await lock({ key: newKey(), version: 1, bind: 'record/rec_00000001', plain: new TextEncoder().encode('{ }') })) ?? new Uint8Array())
const record = { id: 'rec_00000001', object: 'record', ver: 1, seq: 0, deleted: false, body: locked }
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const alias = (value: string) => value.slice(0, -1) + alphabet[alphabet.indexOf(value.at(-1) ?? 'A') ^ 1]

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

test('a record version fits in the uint32 of the header', () => {
  assert.equal(Record.safeParse({ ...record, ver: 0xffffffff }).success, true)
  assert.equal(Record.safeParse({ ...record, ver: 2 ** 32 }).success, false)
})

test('a record body names one of the closed list of kinds', () => {
  assert.equal(RecordKind.safeParse('instructions').success, true)
  assert.equal(RecordKind.safeParse('grants').success, false)
  assert.equal(RecordKind.safeParse('__proto__').success, false)
})

test('bytes have one spelling: a base64url alias of a key, signature or body is refused', async () => {
  const me = await identity()
  const signed = await signRecord({ signer: me, bind: 'b', bytes: newKey(31) })
  assert.equal(Signed.safeParse(signed).success, true)
  assert.notEqual(alias(signed.by), signed.by)
  assert.equal(DeviceKey.safeParse(alias(signed.by)).success, false)
  assert.equal(Signed.safeParse({ ...signed, signature: alias(signed.signature) }).success, false)
  assert.equal(Base64.safeParse(alias(signed.bytes)).success, false)
  assert.equal(Record.safeParse({ ...record, body: alias(locked) }).success, false)
})

test('a signed record body only checks for the workspace, record and kind it was signed for', async () => {
  const mo = await identity()
  const bytes = new TextEncoder().encode('{"value":"Answer billing questions."}')
  const bind = recordBind({ workspace: 'ws_00000001', id: 'agent_a_instructions', kind: 'instructions' })
  const signed = await signRecord({ signer: mo, bind, bytes })
  assert.deepEqual(await checkRecord({ signed, bind }), bytes)
  for (const other of [
    recordBind({ workspace: 'ws_00000001', id: 'agent_b_instructions', kind: 'instructions' }),
    recordBind({ workspace: 'ws_00000002', id: 'agent_a_instructions', kind: 'instructions' }),
    recordBind({ workspace: 'ws_00000001', id: 'agent_a_instructions', kind: 'memory' }),
  ]) {
    assert.equal(await checkRecord({ signed, bind: other }), null)
  }
  assert.equal(await checkRecord({ signed: { ...signed, by: alias(signed.by) }, bind }), null)
})

test('letters, key boxes and here messages carry locked bodies only, and letters say what they carry', async () => {
  const from = toBase64((await identity()).publicKey)
  const to = toBase64((await identity()).publicKey)
  const letter = { id: 'let_00000001', object: 'letter', to, from, workspace: 'ws_00000001', purpose: 'workspace-key', body: locked }
  assert.equal(Letter.safeParse(letter).success, true)
  assert.equal(Letter.safeParse({ ...letter, body: toBase64(newKey()) }).success, false)
  assert.equal(Letter.safeParse({ ...letter, purpose: 'anything' }).success, false)
  assert.equal(KeyBox.safeParse({ object: 'key_box', kind: 'kit', body: locked }).success, true)
  assert.equal(Here.safeParse({ object: 'here', from, body: 'aGk' }).success, false)
})

test('a pairing goes through the QR and comes back whole, and a bad QR is refused', async () => {
  const pairing = await newPairing({ device: (await identity()).publicKey, hint: 'mo@example.com' })
  assert.deepEqual(fromQr(qrPayload(pairing)), pairing)
  const payload = JSON.parse(qrPayload(pairing))
  for (const bad of ['', 'null', '{}', JSON.stringify({ ...payload, secret: 'short' }), JSON.stringify({ ...payload, secret: pairing.secret.toLowerCase() }), JSON.stringify({ ...payload, openhut: 'other' }), JSON.stringify({ ...payload, fingerprint: 'x'.repeat(43) }), JSON.stringify({ ...payload, hint: 'h'.repeat(321) })]) {
    assert.equal(fromQr(bad), null)
  }
})

test('a team website is a hostname or an http(s) URL, kept as the bare host; IPs, localhost, ports and other schemes are refused', () => {
  assert.equal(siteHost(' https://www.Activepieces.com/about?x=1 '), 'www.activepieces.com')
  assert.equal(siteHost('activepieces.com'), 'activepieces.com')
  assert.equal(siteHost('http://café.fr'), 'xn--caf-dma.fr')
  for (const bad of ['', 'localhost', '127.0.0.1', 'https://10.0.0.1/', 'example.com:8080', 'ftp://example.com', 'javascript:alert(1)', 'user@example.com', 'not a site']) assert.equal(siteHost(bad), null, bad)
})
