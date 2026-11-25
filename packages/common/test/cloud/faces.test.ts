import { test } from 'node:test'
import assert from 'node:assert/strict'
import { commitOf } from '../../src/cloud/faces.ts'

test('a commit changes with the nonce and is the same for the same device and nonce', () => {
  assert.equal(commitOf({ device: 'd', nonce: 'n' }), commitOf({ device: 'd', nonce: 'n' }))
  assert.notEqual(commitOf({ device: 'd', nonce: 'a' }), commitOf({ device: 'd', nonce: 'b' }))
})
