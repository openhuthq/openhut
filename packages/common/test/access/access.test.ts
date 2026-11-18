import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { canonical, verify, type Access, type Unsigned } from '../../src/access/access.ts'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const owner = Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).subarray(-32).toString('hex')
const unsigned: Unsigned = { object: 'access', owner, version: 1, clients: [], computers: [] }
const list: Access = { ...unsigned, signature: sign(null, Buffer.from(canonical(unsigned)), privateKey).toString('hex') }
const forged: Access = { ...list, version: 2 }

test('verify checks the owner\'s signature with WebCrypto', async () => {
  assert.equal(await verify(list), true)
  assert.equal(await verify(forged), false)
})

test('verify still checks it where WebCrypto has no Ed25519, like an older Android WebView', async (t) => {
  t.mock.method(crypto.subtle, 'importKey', () => Promise.reject(new DOMException('Algorithm: Unrecognized name', 'NotSupportedError')))
  assert.equal(await verify(list), true)
  assert.equal(await verify(forged), false)
})
