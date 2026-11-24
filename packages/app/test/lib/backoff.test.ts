import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mayRetry } from '../../src/lib/backoff.ts'

test('a computer that never failed is tried at once', () => {
  assert.equal(mayRetry({ now: 0, failed: undefined }), true)
})

test('after a failed try the wait starts at a minute, doubles each time and stops at ten minutes', () => {
  const at = (tries: number, waited: number) => mayRetry({ now: 1_000_000 + waited, failed: { since: 1_000_000, tries } })
  assert.equal(at(1, 5_000), false)
  assert.equal(at(1, 59_999), false)
  assert.equal(at(1, 60_000), true)
  assert.equal(at(2, 119_999), false)
  assert.equal(at(2, 120_000), true)
  assert.equal(at(4, 479_999), false)
  assert.equal(at(5, 599_999), false)
  assert.equal(at(5, 600_000), true)
  assert.equal(at(20, 600_000), true)
})
