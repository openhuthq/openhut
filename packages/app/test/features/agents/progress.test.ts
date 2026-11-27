import { test } from 'node:test'
import assert from 'node:assert/strict'
import { previewOf, summaryOf } from '../../../src/features/agents/progress.ts'

test('an agent row shows waiting over working, and nothing when idle', () => {
  assert.equal(summaryOf({ working: 2, waiting: 1, activity: 'working' }), 'waiting')
  assert.equal(summaryOf({ working: 0, waiting: 0, activity: 'waiting' }), 'waiting')
  assert.equal(summaryOf({ working: 1, waiting: 0, activity: 'idle' }), 'working')
  assert.equal(summaryOf({ working: 0, waiting: 0, activity: 'working' }), 'working')
  assert.equal(summaryOf({ working: 0, waiting: 0, activity: 'idle' }), undefined)
})

test('an agent row previews its newest thread, or what it does when that is the main chat', () => {
  const threads = [{ id: 'ag_1', title: 'Ops', updatedAt: '2026-11-27T09:00:00Z' }, { id: 'th_a', title: 'Stripe payout failed', updatedAt: '2026-11-27T10:00:00Z' }]
  assert.deepEqual(previewOf({ agentId: 'ag_1', summary: 'Checks invoices', threads }), { text: 'Stripe payout failed', at: '2026-11-27T10:00:00Z' })
  assert.deepEqual(previewOf({ agentId: 'ag_1', summary: 'Checks invoices', threads: threads.slice(0, 1) }), { text: 'Checks invoices', at: '2026-11-27T09:00:00Z' })
  assert.deepEqual(previewOf({ agentId: 'ag_1', summary: '', threads: [] }), { text: 'Say hello', at: undefined })
})
