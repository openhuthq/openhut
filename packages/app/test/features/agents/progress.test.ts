import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summaryOf } from '../../../src/features/agents/progress.ts'

test('an agent row shows waiting over working, and nothing when idle', () => {
  assert.equal(summaryOf({ working: 2, waiting: 1, activity: 'working' }), 'waiting')
  assert.equal(summaryOf({ working: 0, waiting: 0, activity: 'waiting' }), 'waiting')
  assert.equal(summaryOf({ working: 1, waiting: 0, activity: 'idle' }), 'working')
  assert.equal(summaryOf({ working: 0, waiting: 0, activity: 'working' }), 'working')
  assert.equal(summaryOf({ working: 0, waiting: 0, activity: 'idle' }), undefined)
})
