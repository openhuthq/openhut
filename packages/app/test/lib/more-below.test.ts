import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moreBelow } from '../../src/lib/more-below.ts'

test('a list fades at the bottom only while there is more to scroll', () => {
  assert.equal(moreBelow({ scrollHeight: 400, scrollTop: 0, clientHeight: 400 }), false)
  assert.equal(moreBelow({ scrollHeight: 900, scrollTop: 0, clientHeight: 400 }), true)
  assert.equal(moreBelow({ scrollHeight: 900, scrollTop: 499.5, clientHeight: 400 }), false)
})
