import { test } from 'node:test'
import assert from 'node:assert/strict'
import { byCreation } from '../../../src/features/agents/progress.ts'

test('the sidebar keeps agents in the order they were made, oldest first, whatever they are doing', () => {
  const contact = (id: string, createdAt: string, busyAt: string) => ({ agent: { id, createdAt }, threads: [{ updatedAt: busyAt }] })
  const list = [contact('ag_c', '2026-11-03T00:00:00Z', '2026-11-27T10:00:00Z'), contact('ag_a', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z'), contact('ag_b', '2026-11-01T00:00:00Z', '2026-11-27T11:00:00Z')]
  assert.deepEqual(byCreation(list).map((each) => each.agent.id), ['ag_a', 'ag_b', 'ag_c'])
})
