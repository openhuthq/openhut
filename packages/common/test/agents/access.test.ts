import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Agent, canUse, inSidebar } from '../../src/agents/agent.ts'

const OWNER = 'mo@example.com'

test('only people I pick: the owner and the picked people can open it, nobody else on the team', () => {
  const access = { owner: OWNER, shared: false, people: ['sara@example.com'], sidebars: [] }
  assert.equal(canUse(access, OWNER), true)
  assert.equal(canUse(access, 'sara@example.com'), true)
  assert.equal(canUse(access, 'ana@example.com'), false)
  assert.equal(inSidebar(access, 'sara@example.com'), true)
  assert.equal(inSidebar(access, 'ana@example.com'), false)
})

test('everyone on the team can open it; sidebars name who sees it, and nobody named means everyone', () => {
  const open = { owner: OWNER, shared: true, people: [], sidebars: [] }
  assert.equal(canUse(open, 'ana@example.com'), true)
  assert.equal(inSidebar(open, 'ana@example.com'), true)
  const named = { ...open, sidebars: ['sara@example.com'] }
  assert.equal(inSidebar(named, 'sara@example.com'), true)
  assert.equal(inSidebar(named, 'ana@example.com'), false)
  assert.equal(canUse(named, 'ana@example.com'), true, 'off the sidebar is not locked out')
  assert.equal(inSidebar(named, OWNER), true)
})

test('an agent from an older runtime reads as only its owner, in their sidebar', () => {
  const agent = Agent.parse({ id: 'ag_1', object: 'agent', name: 'Juniper', ownerId: 'o', ownerName: 'o', model: 'claude:sonnet', wanted: 'running', status: 'running', health: null, healthDetail: '', summary: '', net: 0, instructions: '', codeExecution: true, browser: false, canEdit: true, createdAt: '2026-11-24T00:00:00Z' })
  assert.deepEqual([agent.shared, agent.people, agent.sidebars, agent.inSidebar], [false, [], [], true])
})
