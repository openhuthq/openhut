import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byCreation, previewOf } from '../../../src/features/agents/progress.ts'

test('an agent row shows its newest message and when it came, the main thread included', () => {
  const agent = { id: 'ag_1', name: 'CI Police', instructions: '# CI Police' }
  const main = { id: 'ag_1', title: 'CI Police', preview: 'Release pieces passed.', updatedAt: '2026-11-27T09:00:00Z' }
  assert.deepEqual(previewOf({ agent, threads: [main] }), { text: 'Release pieces passed.', at: '2026-11-27T09:00:00Z' })
  const newer = { id: 'th_a', title: 'Stripe payout failed', preview: 'Checking the payout…', updatedAt: '2026-11-27T10:00:00Z' }
  assert.deepEqual(previewOf({ agent, threads: [main, newer] }), { text: 'Checking the payout…', at: '2026-11-27T10:00:00Z' })
  assert.equal(previewOf({ agent, threads: [{ ...newer, preview: '' }] }).text, 'Stripe payout failed')
})

test('an agent with no messages shows what it does as one plain line, without markdown or its own name', () => {
  const instructions = '# CI Police\n\nCI Police\n\n## How it works\n\n**GitHub** pins a [release](https://x.dev) and `watches`\n- the _pieces_ build\n\n'
  assert.deepEqual(previewOf({ agent: { id: 'ag_1', name: 'CI Police', instructions }, threads: [] }), { text: 'How it works GitHub pins a release and watches the pieces build', at: undefined })
  assert.equal(previewOf({ agent: { id: 'ag_1', name: 'Ops', instructions: '# Ops' }, threads: [] }).text, 'Say hello')
})

test('the sidebar keeps agents in the order they were made, oldest first, whatever they are doing', () => {
  const contact = (id: string, createdAt: string, busyAt: string) => ({ agent: { id, createdAt }, threads: [{ updatedAt: busyAt }] })
  const list = [contact('ag_c', '2026-11-03T00:00:00Z', '2026-11-27T10:00:00Z'), contact('ag_a', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z'), contact('ag_b', '2026-11-01T00:00:00Z', '2026-11-27T11:00:00Z')]
  assert.deepEqual(byCreation(list).map((each) => each.agent.id), ['ag_a', 'ag_b', 'ag_c'])
})
