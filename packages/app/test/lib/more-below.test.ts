import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moreBelow, stillPinned } from '../../src/lib/more-below.ts'

test('a list fades at the bottom only while there is more to scroll', () => {
  assert.equal(moreBelow({ scrollHeight: 400, scrollTop: 0, clientHeight: 400 }), false)
  assert.equal(moreBelow({ scrollHeight: 900, scrollTop: 0, clientHeight: 400 }), true)
  assert.equal(moreBelow({ scrollHeight: 900, scrollTop: 499.5, clientHeight: 400 }), false)
})

test('A chat stays pinned to the bottom until the person scrolls up', () => {
  const box = { scrollHeight: 3000, clientHeight: 800 }
  assert.equal(stillPinned({ ...box, pinned: true, scrollTop: 1900, lastTop: 2200 }), false)
  assert.equal(stillPinned({ ...box, pinned: true, scrollTop: 1500, lastTop: 1500 }), true)
  assert.equal(stillPinned({ ...box, pinned: true, scrollTop: 1700, lastTop: 1500 }), true)
  assert.equal(stillPinned({ ...box, pinned: false, scrollTop: 1700, lastTop: 1500 }), false)
  assert.equal(stillPinned({ ...box, pinned: false, scrollTop: 2150, lastTop: 1700 }), true)
})
