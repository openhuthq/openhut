import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPublicKey, verify } from 'node:crypto'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deviceName, ownerKeys } from '../src/owner-keys.mjs'

const safeStorage = {
  encryptStringAsync: async (text: string) => Buffer.from(`sealed:${Buffer.from(text).toString('base64')}`),
  decryptStringAsync: async (data: Buffer) => ({ result: Buffer.from(String(data).slice('sealed:'.length), 'base64').toString() }),
}

test('the owner and device keys are made once, kept sealed by safeStorage, and the owner key signs', async () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'oh-keys-')), 'keys')
  const first = await ownerKeys({ dir, safeStorage, name: 'Mos MacBook Pro' })
  const again = await ownerKeys({ dir, safeStorage, name: 'Mos MacBook Pro' })
  assert.deepEqual([again.key, again.self], [first.key, first.self])
  assert.match(first.key, /^[0-9a-f]{64}$/)
  assert.match(first.self.key, /^[0-9a-f]{64}$/)
  assert.notEqual(first.key, first.self.key)
  for (const file of ['owner.key', 'device.key']) {
    assert.equal(statSync(join(dir, file)).mode & 0o777, 0o600)
    assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), /PRIVATE KEY/)
  }
  const owner = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(first.key, 'hex').toString('base64url') }, format: 'jwk' })
  assert.ok(verify(null, Buffer.from('{"version":1}'), owner, Buffer.from(await first.sign('{"version":1}'), 'hex')))
})

test('a device is named after the Mac\'s host name, without .local', () => {
  assert.equal(deviceName('Mos-MacBook-Pro.local'), 'Mos MacBook Pro')
  assert.equal(deviceName(''), 'Mac')
})
