import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FACES } from '../../src/cloud/cloud.ts'
import { commitOf, facesOf } from '../../src/cloud/faces.ts'

test('two different faces from the key and nonce, the same on both computers, and a commit that changes with the nonce', () => {
  for (let i = 0; i < 200; i++) {
    const [a, b] = facesOf({ device: `dev${i}`, nonce: `n${i}` })
    assert.ok(a < b && b < FACES)
  }
  assert.deepEqual(facesOf({ device: 'd', nonce: 'n' }), facesOf({ device: 'd', nonce: 'n' }))
  assert.notEqual(commitOf({ device: 'd', nonce: 'a' }), commitOf({ device: 'd', nonce: 'b' }))
})
