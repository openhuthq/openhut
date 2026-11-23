import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import curve from 'noise-handshake/dh.js'
import { fromHex, generateKeyPair, initiator, responder, toHex } from '../src/noise.ts'
import { nativeKey } from './relay.ts'

type Vector = {
  protocol_name: string
  init_prologue: string
  init_static: string
  init_ephemeral: string
  init_remote_static: string
  resp_static: string
  resp_ephemeral: string
  handshake_hash: string
  messages: { payload: string; ciphertext: string }[]
}

const { vectors }: { vectors: Vector[] } = JSON.parse(readFileSync(new URL('./fixtures/cacophony/ik-25519-chachapoly-blake2b.json', import.meta.url), 'utf8'))

test('Noise_IK_25519_ChaChaPoly_BLAKE2b cacophony vectors produce identical ciphertexts', async t => {
  assert.ok(vectors.length > 0)
  let messages = 0
  for (const vector of vectors) {
    assert.equal(vector.protocol_name, 'Noise_IK_25519_ChaChaPoly_BLAKE2b')
    const prologue = fromHex(vector.init_prologue)
    const device = initiator({ key: curve.generateKeyPair(fromHex(vector.init_static)), remote: fromHex(vector.init_remote_static), prologue, ephemeral: fromHex(vector.init_ephemeral) })
    const computer = responder({ key: curve.generateKeyPair(fromHex(vector.resp_static)), prologue, ephemeral: fromHex(vector.resp_ephemeral) })
    const [first, second, ...rest] = vector.messages
    assert.equal(toHex(await device.write(fromHex(first.payload))), first.ciphertext)
    assert.equal(toHex(computer.read(fromHex(first.ciphertext))), first.payload)
    const reply = computer.write(fromHex(second.payload))
    assert.equal(toHex(reply.message), second.ciphertext)
    const done = await device.read(fromHex(second.ciphertext))
    assert.equal(toHex(done.payload), second.payload)
    assert.equal(toHex(done.transport.handshakeHash), vector.handshake_hash)
    assert.equal(toHex(reply.transport.handshakeHash), vector.handshake_hash)
    rest.forEach(({ payload, ciphertext }, index) => {
      const [sender, receiver] = index % 2 === 0 ? [done.transport, reply.transport] : [reply.transport, done.transport]
      assert.equal(toHex(sender.encrypt(fromHex(payload))), ciphertext)
      assert.equal(toHex(receiver.decrypt(fromHex(ciphertext))), payload)
    })
    messages += vector.messages.length
  }
  t.diagnostic(`${vectors.length} vector(s), ${messages} messages matched`)
})

test('a device key that only offers async agree completes IK with empty payloads', async () => {
  const computerKey = generateKeyPair()
  const native = nativeKey()
  const device = initiator({ key: native.key, remote: computerKey.publicKey })
  const computer = responder({ key: computerKey })
  const first = await device.write()
  assert.equal(computer.read(first).byteLength, 0)
  const reply = computer.write()
  const { transport } = await device.read(reply.message)
  assert.deepEqual(native.agreed, [toHex(computerKey.publicKey), toHex(reply.message.subarray(0, 32))])
  assert.equal(toHex(reply.transport.remoteKey), native.hex)
  assert.equal(new TextDecoder().decode(reply.transport.decrypt(transport.encrypt(new TextEncoder().encode('hi')))), 'hi')
  assert.deepEqual(transport.handshakeHash, reply.transport.handshakeHash)
})

test('a device key with neither a secret nor agree is refused', () => {
  assert.throws(() => initiator({ key: { publicKey: new Uint8Array(32) }, remote: generateKeyPair().publicKey }), /secret key or an agree function/)
})
