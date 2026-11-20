import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createCipheriv, createDecipheriv, createHmac, createPublicKey, hkdfSync, verify } from 'node:crypto'
import * as vault from '../../src/vault/vault.ts'

const vectors = JSON.parse(readFileSync(new URL('./vectors.json', import.meta.url), 'utf8'))
const v1 = vectors['1']
const bytes = (hex: string) => new Uint8Array(Buffer.from(hex, 'hex'))
const hex = (value: Uint8Array) => Buffer.from(value).toString('hex')
const utf8 = (value: string) => new TextEncoder().encode(value)

function must<T>(value: T | null): T {
  assert.ok(value)
  return value
}

function fixRandom(t: TestContext, value: Uint8Array) {
  t.mock.method(crypto, 'getRandomValues', <T extends ArrayBufferView | null>(array: T) => {
    if (array instanceof Uint8Array) array.set(value.subarray(0, array.length))
    return array
  })
}

async function lock({ key, version, bind, plain }: { key: vault.Bytes; version: number; bind: string; plain: vault.Bytes }) {
  return must(await vault.lock({ key, version, bind, plain }))
}

test('lock then unlock round-trips', async () => {
  const key = vault.newKey()
  const locked = await lock({ key, version: 7, bind: 'record/a', plain: utf8('hello') })
  assert.equal(new TextDecoder().decode((await vault.unlock({ keys: { 7: key }, bind: 'record/a', locked })) ?? undefined), 'hello')
})

test('a wrong key, one flipped byte, a wrong version or another record fails', async () => {
  const key = vault.newKey()
  const locked = await lock({ key, version: 7, bind: 'record/a', plain: utf8('hello') })
  assert.equal(await vault.unlock({ keys: { 7: vault.newKey() }, bind: 'record/a', locked }), null)
  for (const index of [5, vault.HEADER + 1, locked.length - 1]) {
    const flipped = locked.slice()
    flipped[index] ^= 1
    assert.equal(await vault.unlock({ keys: { 7: key, 6: key }, bind: 'record/a', locked: flipped }), null)
  }
  assert.equal(await vault.unlock({ keys: { 6: key }, bind: 'record/a', locked }), null)
  assert.equal(await vault.unlock({ keys: { 7: key }, bind: 'record/b', locked }), null)
})

test('lock refuses a version outside uint32 and a key that is not 32 bytes', async () => {
  const key = vault.newKey()
  for (const version of [2 ** 32, -1, 1.5, Number.NaN]) {
    assert.equal(await vault.lock({ key, version, bind: 'r', plain: utf8('x') }), null)
  }
  assert.equal(vault.readHeader(await lock({ key, version: 0xffffffff, bind: 'r', plain: utf8('x') }))?.version, 0xffffffff)
  for (const length of [16, 31, 33, 64]) {
    assert.equal(await vault.lock({ key: vault.newKey(length), version: 1, bind: 'r', plain: utf8('x') }), null)
  }
})

test('data locked before a key change still opens with its old version', async () => {
  const old = vault.newKey()
  const locked = await lock({ key: old, version: 6, bind: 'r', plain: utf8('x') })
  assert.ok(await vault.unlock({ keys: { 6: old, 7: vault.newKey() }, bind: 'r', locked }))
})

test('lock uses the newest suite and an unknown suite is refused', async () => {
  const key = vault.newKey()
  const locked = await lock({ key, version: 1, bind: 'r', plain: utf8('x') })
  assert.equal(locked[1], vault.NEWEST)
  const unknown = locked.slice()
  unknown[1] = 99
  assert.equal(vault.isLocked(unknown), false)
  assert.equal(await vault.unlock({ keys: { 1: key }, bind: 'r', locked: unknown }), null)
})

test('unlock opens each value with the parameters of its own suite', async () => {
  vault.suites[2] = { ...vault.suites[1], nonce: 16 }
  const key = vault.newKey()
  const head = Buffer.from([1, 2, 0, 0, 0, 1])
  const nonce = Buffer.from(vault.newKey(16))
  const subkey = Buffer.from(hkdfSync('sha256', key, nonce, Buffer.from('openhut/lock\0r'), 32))
  const cipher = createCipheriv('aes-256-gcm', subkey, nonce).setAAD(Buffer.concat([head, Buffer.from('r')]))
  const sealed = Buffer.concat([cipher.update('suite two'), cipher.final(), cipher.getAuthTag()])
  const locked = new Uint8Array(Buffer.concat([head, nonce, sealed]))
  assert.equal(new TextDecoder().decode(must(await vault.unlock({ keys: { 1: key }, bind: 'r', locked }))), 'suite two')
  locked[1] = 1
  assert.equal(await vault.unlock({ keys: { 1: key }, bind: 'r', locked }), null)
  delete vault.suites[2]
})

test('lock matches its vector byte for byte, and suite 1 vectors still open', async (t) => {
  const { key, version, bind, nonce, plain, locked } = v1.lock
  fixRandom(t, bytes(nonce))
  assert.equal(hex(await lock({ key: bytes(key), version, bind, plain: bytes(plain) })), locked)
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

test('check refuses small-order public keys, even with a signature that verifies any message', async () => {
  const neutral = bytes(`01${'00'.repeat(31)}`)
  const publicKey = vault.concat([neutral, vault.newKey()])
  const signature = vault.concat([neutral, new Uint8Array(32)])
  for (const message of [utf8('member list'), utf8('anything else')]) {
    assert.equal(await vault.check({ publicKey, bytes: message, signature }), false)
  }
  const signedHigh = publicKey.slice()
  signedHigh[31] |= 0x80
  assert.equal(await vault.check({ publicKey: signedHigh, bytes: utf8('x'), signature }), false)
})

test('a letter opens only for its recipient, from a sender on the list, for its purpose', async () => {
  const [ana, mo, eve] = await Promise.all([vault.identity(), vault.identity(), vault.identity()])
  const key = vault.newKey()
  const sent = { workspace: 'ws_1', purpose: 'workspace-key' as const }
  const body = must(await vault.letter({ sender: mo, to: ana.publicKey, ...sent, version: 3, plain: key }))
  const allowed = [mo.publicKey]
  assert.deepEqual(await vault.read({ recipient: ana, from: mo.publicKey, ...sent, body, allowed }), key)
  assert.equal(await vault.read({ recipient: eve, from: mo.publicKey, ...sent, body, allowed }), null)
  assert.equal(await vault.read({ recipient: ana, from: mo.publicKey, ...sent, body, allowed: [eve.publicKey] }), null)
  assert.equal(await vault.read({ recipient: ana, from: mo.publicKey, ...sent, workspace: 'ws_2', body, allowed }), null)
  assert.equal(await vault.read({ recipient: ana, from: mo.publicKey, ...sent, purpose: 'connection-key', body, allowed }), null)
  const forged = must(await vault.letter({ sender: eve, to: ana.publicKey, ...sent, version: 3, plain: key }))
  assert.equal(await vault.read({ recipient: ana, from: mo.publicKey, ...sent, body: forged, allowed }), null)
  const otherVersion = body.slice()
  otherVersion[5] = 4
  assert.equal(await vault.read({ recipient: ana, from: mo.publicKey, ...sent, body: otherVersion, allowed }), null)
  assert.equal(await vault.letter({ sender: mo, to: ana.publicKey, ...sent, version: 2 ** 32, plain: key }), null)
})

test('the letter context length-prefixes its fields, so a workspace cannot borrow bytes from the plaintext', () => {
  assert.equal(vault.equal({ a: vault.concat([vault.field('w'), utf8('Xp')]), b: vault.concat([vault.field('wX'), utf8('p')]) }), false)
  assert.equal(hex(vault.field('ws')), '000000027773')
})

test('the letter vector still opens', async () => {
  const { sender, recipient, workspace, purpose, plain, body } = v1.letter
  const from = await vault.identity(bytes(sender))
  const opened = await vault.read({ recipient: await vault.identity(bytes(recipient)), from: from.publicKey, workspace, purpose, body: bytes(body), allowed: [from.publicKey] })
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

test('a pairing goes through the QR and comes back whole', async () => {
  const mac = await vault.identity()
  const pairing = await vault.newPairing({ device: mac.publicKey, hint: 'mo@example.com' })
  assert.match(pairing.secret, /^[0-9A-HJKMNP-TV-Z]{20}$/)
  assert.deepEqual(vault.fromQr(vault.qrPayload(pairing)), pairing)
  assert.equal(pairing.fingerprint, await vault.fingerprint(mac.publicKey))
  for (const payload of ['', 'null', '{}', JSON.stringify({ ...JSON.parse(vault.qrPayload(pairing)), secret: 'short' }), JSON.stringify({ ...JSON.parse(vault.qrPayload(pairing)), openhut: 'other' })]) {
    assert.equal(vault.fromQr(payload), null)
  }
})

test('the long code round-trips, forgives case, O and I, and catches every one-character typo', async () => {
  const { secret } = await vault.newPairing({ device: (await vault.identity()).publicKey, hint: '' })
  const code = vault.longCode(secret)
  assert.match(code, /^([0-9A-Z]{5}-){4}[0-9A-Z*~$=]$/)
  assert.equal(vault.fromLongCode(code), secret)
  assert.equal(vault.fromLongCode(code.toLowerCase().replaceAll('-', ' ')), secret)
  assert.equal(vault.fromLongCode('O1234-56789-ABCDE-FGHJK-H'), '0123456789ABCDEFGHJK')
  assert.equal(vault.fromLongCode('0i234-56789-ABCDE-FGHJK-H'), '0123456789ABCDEFGHJK')
  const plain = code.replaceAll('-', '')
  for (let index = 0; index < plain.length; index++) {
    for (const other of '0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U') {
      if (other !== plain[index]) assert.equal(vault.fromLongCode(plain.slice(0, index) + other + plain.slice(index + 1)), null)
    }
  }
  for (let index = 0; index < plain.length - 1; index++) {
    const swapped = plain.slice(0, index) + plain[index + 1] + plain[index] + plain.slice(index + 2)
    if (swapped !== plain) assert.equal(vault.fromLongCode(swapped), null)
  }
  assert.equal(vault.fromLongCode(plain.slice(0, -1)), null)
})

test('a device key the cloud swaps in, or a wrong secret, fails the pairing', async () => {
  const [mac, cloud] = await Promise.all([vault.identity(), vault.identity()])
  const pairing = await vault.newPairing({ device: mac.publicKey, hint: '' })
  const tag = await vault.mac({ secret: pairing.secret, side: 'new', bytes: mac.publicKey })
  assert.equal(await vault.verify({ secret: pairing.secret, side: 'new', bytes: mac.publicKey, tag }), true)
  assert.notEqual(await vault.fingerprint(cloud.publicKey), pairing.fingerprint)
  assert.equal(await vault.verify({ secret: pairing.secret, side: 'new', bytes: cloud.publicKey, tag }), false)
  const guess = await vault.mac({ secret: (await vault.newPairing({ device: cloud.publicKey, hint: '' })).secret, side: 'new', bytes: cloud.publicKey })
  assert.equal(await vault.verify({ secret: pairing.secret, side: 'new', bytes: cloud.publicKey, tag: guess }), false)
  assert.equal(await vault.verify({ secret: pairing.secret, side: 'old', bytes: mac.publicKey, tag }), false)
  assert.equal(await vault.verify({ secret: 'not a secret', side: 'new', bytes: mac.publicKey, tag }), false)
})

test('the pairing vector matches, and its MAC key derives with plain node:crypto', async () => {
  const { secret, longCode, device, fingerprint, side, mac } = v1.pair
  assert.equal(vault.longCode(secret), longCode)
  assert.equal(await vault.fingerprint(bytes(device)), fingerprint)
  assert.equal(hex(await vault.mac({ secret, side, bytes: bytes(device) })), mac)
  const key = Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.alloc(0), Buffer.from('openhut/pair'), 32))
  assert.equal(createHmac('sha256', key).update(Buffer.concat([vault.field(side), bytes(device)])).digest('hex'), mac)
})

test('slots are a keyed hash of the path', async () => {
  const { key, path, slot } = v1.slot
  assert.equal(await vault.slot({ key: bytes(key), path }), slot)
  assert.notEqual(await vault.slot({ key: vault.newKey(), path }), slot)
})
