import { test } from 'node:test'
import assert from 'node:assert/strict'
import { acted, CloudPaused } from '../../src/lib/remote.ts'

test('a settings read right after a click asks a paused Cloud to wake, and a paused background read has nothing to show', () => {
  Object.defineProperty(globalThis, 'navigator', { value: { userActivation: { isActive: true } }, configurable: true })
  assert.equal(acted({ method: 'GET' }), true)
  Object.defineProperty(globalThis, 'navigator', { value: { userActivation: { isActive: false } }, configurable: true })
  assert.equal(acted(), false)
  assert.equal(acted({ method: 'PATCH' }), true)
  assert.equal(new CloudPaused().message, '')
})
