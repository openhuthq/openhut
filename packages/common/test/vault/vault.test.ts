import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDecipheriv, createPublicKey, hkdfSync, verify } from 'node:crypto'
import * as vault from '../../src/vault/vault.ts'

const vectors = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'))
const v1 = vectors['1']
const bytes = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'))
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex')
const utf8 = (value: string) => new TextEncoder().encode(value)

function fixRandom(t: TestContext, value: Uint8Array) {
  t.mock.method(crypto, 'getRandomValues', <T extends ArrayBufferView | null>(array: T) => {
    if (array instanceof Uint8Array) array.set(value.subarray(0, array.length))
    return array
  })
}

test('lock then unlock round-trips', async () => {
  const key = vault.newKey()
  const locked = await vault.lock({ key, version: 7, bind: 'record/a', plain: utf8('hello') })
  assert.equal(new TextDecoder().decode((await vault.unlock({ keys: { 7: key }, bind: 'record/a', locked })) ?? undefined), 'hello')
})

test('a wrong key, one flipped byte, a wrong version or another record fails', async () => {
  const key = vault.newKey()
  const locked = await vault.lock({ key, version: 7, bind: 'record/a', plain: utf8('hello') })
  assert.equal(await vault.unlock({ keys: { 7: vault.newKey() }, bind: 'record/a', locked }), null)
  for (const index of [5, vault.HEADER + 1, locked.length - 1]) {
    const flipped = locked.slice()
    flipped[index] ^= 1
    assert.equal(await vault.unlock({ keys: { 7: key, 6: key }, bind: 'record/a', locked: flipped }), null)
  }
  assert.equal(await vault.unlock({ keys: { 6: key }, bind: 'record/a', locked }), null)
  assert.equal(await vault.unlock({ keys: { 7: key }, bind: 'record/b', locked }), null)
})

test('data locked before a key change still opens with its old version', async () => {
  const old = vault.newKey()
  const locked = await vault.lock({ key: old, version: 6, bind: 'r', plain: utf8('x') })
  assert.ok(await vault.unlock({ keys: { 6: old, 7: vault.newKey() }, bind: 'r', locked }))
})

test('lock uses the newest suite and an unknown suite is refused', async () => {
  const key = vault.newKey()
  const locked = await vault.lock({ key, version: 1, bind: 'r', plain: utf8('x') })
  assert.equal(locked[1], vault.NEWEST)
  const unknown = locked.slice()
  unknown[1] = 99
  assert.equal(vault.isLocked(unknown), false)
  assert.equal(await vault.unlock({ keys: { 1: key }, bind: 'r', locked: unknown }), null)
})

test('lock matches its vector byte for byte, and suite 1 vectors still open', async (t) => {
  const { key, version, bind, nonce, plain, locked } = v1.lock
  fixRandom(t, bytes(nonce))
  assert.equal(hex(await vault.lock({ key: bytes(key), version, bind, plain: bytes(plain) })), locked)
  t.mock.restoreAll()
  assert.equal(hex((await vault.unlock({ keys: { [version]: bytes(key) }, bind, locked: bytes(locked) })) ?? new Uint8Array()), plain)
})

test('the lock vector opens with plain node:crypto, so the format is standard', () => {
  const { key, bind, plain, locked } = v1.lock
  const all = Buffer.from(locked, 'hex')
  const [head, nonce, sealed] = [all.subarray(0, 6), all.subarray(6, 18), all.subarray(18)]
  const subkey = Buffer.from(hkdfSync('sha256', Buffer.from(key, 'hex'), nonce, Buffer.from(`openhut/lock\0${bind}`), 32))
  const decipher = createDecipheriv('aes-256-gcm', subkey, nonce).setAAD(Buffer.concat([head, Buffer.from(bind)])).setAuthTag(sealed.subarray(-16))
  assert.equal(Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]).toString('hex'), plain)
})

test('sign and check over exact bytes match the vector and node:crypto', async () => {
  const { secret, publicKey, bytes: message, signature } = v1.sign
  const me = await vault.identity(bytes(secret))
  assert.equal(hex(me.publicKey), publicKey)
  assert.equal(hex(await vault.sign({ secret: bytes(secret), bytes: bytes(message) })), signature)
  assert.equal(await vault.check({ publicKey: bytes(publicKey), bytes: bytes(message), signature: bytes(signature) }), true)
  const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKey.slice(0, 64), 'hex')])
  assert.equal(verify(null, Buffer.from(message, 'hex'), createPublicKey({ key: spki, format: 'der', type: 'spki' }), Buffer.from(signature, 'hex')), true)
  const changed = bytes(message)
  changed[0] ^= 1
  assert.equal(await vault.check({ publicKey: bytes(publicKey), bytes: changed, signature: bytes(signature) }), false)
})

test('a letter opens only for its recipient, from a sender on the list', async () => {
  const [ana, mo, eve] = await Promise.all([vault.identity(), vault.identity(), vault.identity()])
  const key = vault.newKey()
  const body = await vault.letter({ sender: mo, to: ana.publicKey, workspace: 'ws_1', version: 3, plain: key })
  const allowed = [mo.publicKey]
  assert.deepEqual(await vault.read({ recipient: ana, from: mo.publicKey, workspace: 'ws_1', body, allowed }), key)
  assert.equal(await vault.read({ recipient: eve, from: mo.publicKey, workspace: 'ws_1', body, allowed }), null)
  assert.equal(await vault.read({ recipient: ana, from: mo.publicKey, workspace: 'ws_1', body, allowed: [eve.publicKey] }), null)
  assert.equal(await vault.read({ recipient: ana, from: mo.publicKey, workspace: 'ws_2', body, allowed }), null)
  const forged = await vault.letter({ sender: eve, to: ana.publicKey, workspace: 'ws_1', version: 3, plain: key })
  assert.equal(await vault.read({ recipient: ana, from: mo.publicKey, workspace: 'ws_1', body: forged, allowed }), null)
  const otherVersion = body.slice()
  otherVersion[5] = 4
  assert.equal(await vault.read({ recipient: ana, from: mo.publicKey, workspace: 'ws_1', body: otherVersion, allowed }), null)
})

test('the letter vector still opens', async () => {
  const { sender, recipient, workspace, plain, body } = v1.letter
  const from = await vault.identity(bytes(sender))
  const opened = await vault.read({ recipient: await vault.identity(bytes(recipient)), from: from.publicKey, workspace, body: bytes(body), allowed: [from.publicKey] })
  assert.equal(hex(opened ?? new Uint8Array()), plain)
})

test('12 words give back the same key and a typo in one word is caught', async (t) => {
  const { words, key } = await vault.newWords()
  assert.equal(words.length, 12)
  assert.deepEqual(await vault.fromWords(words), key)
  assert.deepEqual(await vault.fromWords(words.map((word) => ` ${word.toUpperCase()} `)), key)
  const typo = [...v1.words.words]
  typo[4] = 'abandon'
  assert.equal(await vault.fromWords(typo), null)
  assert.equal(await vault.fromWords([...words.slice(0, 11), 'zooo']), null)
  assert.equal(await vault.fromWords(words.slice(0, 11)), null)
  fixRandom(t, bytes(v1.words.entropy))
  const fixed = await vault.newWords()
  assert.deepEqual(fixed.words, v1.words.words)
  assert.equal(hex(fixed.key), v1.words.key)
})

test('the 6-digit code needs the commitment it was made with', async (t) => {
  const { newDevice, oldDevice, nonce, commitment, code } = v1.code
  fixRandom(t, bytes(nonce))
  assert.equal(hex((await vault.commit(bytes(newDevice))).commitment), commitment)
  t.mock.restoreAll()
  assert.equal(await vault.pairingCode({ commitment: bytes(commitment), nonce: bytes(nonce), newDevice: bytes(newDevice), oldDevice: bytes(oldDevice) }), code)
  const swapped = await vault.identity()
  assert.equal(await vault.pairingCode({ commitment: bytes(commitment), nonce: bytes(nonce), newDevice: swapped.publicKey, oldDevice: bytes(oldDevice) }), null)
})

test('slots are a keyed hash of the path', async () => {
  const { key, path, slot } = v1.slot
  assert.equal(await vault.slot({ key: bytes(key), path }), slot)
  assert.notEqual(await vault.slot({ key: vault.newKey(), path }), slot)
})
