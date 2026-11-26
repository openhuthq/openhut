import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentPath, goneAgentPath, routeOf, threadRoute } from '../../src/app/routes.ts'

test('every screen has one path and the dialog lives in it', () => {
  assert.deepEqual(routeOf('/'), { page: 'home', adding: false })
  assert.deepEqual(routeOf('/agents'), { page: 'home', adding: false })
  assert.deepEqual(routeOf('/new'), { page: 'home', adding: true })
  assert.deepEqual(routeOf('/agents/ag_1'), { page: 'agent', agentId: 'ag_1', dialog: undefined, detail: undefined })
  assert.deepEqual(routeOf('/agents/ag_1/skills/pdf'), { page: 'agent', agentId: 'ag_1', dialog: 'skills', detail: 'pdf' })
  assert.deepEqual(routeOf('/agents/ag_1/skills'), { page: 'agent', agentId: 'ag_1', dialog: 'skills', detail: undefined })
  assert.deepEqual(routeOf('/agents/ag_1/browser'), { page: 'agent', agentId: 'ag_1', dialog: 'browser', detail: undefined })
  assert.deepEqual(routeOf('/connections/new/postgres'), { page: 'connections' })
  assert.deepEqual(routeOf('/settings'), { page: 'settings', tab: 'people' })
  assert.deepEqual(routeOf('/settings/computers'), { page: 'settings', tab: 'computers' })
  assert.deepEqual(routeOf('/agents/ag_1/does/x'), { page: 'missing' })
  assert.deepEqual(routeOf('/people'), { page: 'missing' })
})

test('agentPath round-trips through routeOf', () => {
  const path = agentPath({ agentId: 'ag 1', dialog: 'skills', detail: 'sk/2' })
  assert.deepEqual(routeOf(path), { page: 'agent', agentId: 'ag 1', dialog: 'skills', detail: 'sk/2' })
})

test('a deleted or missing agent sends you home, where the first agent opens', () => {
  assert.equal(goneAgentPath({ agentId: 'ag_1', listed: ['ag_2', 'ag_3'] }), '/')
  assert.equal(goneAgentPath({ agentId: 'ag_1', listed: [] }), '/')
  assert.equal(goneAgentPath({ agentId: 'ag_1', listed: ['ag_1'] }), undefined)
})

test('a thread from another channel has its own path, and the agent\'s own chat stays on the agent\'s', () => {
  assert.equal(threadRoute({ agentId: 'ag_1', threadId: 'ag_1' }), '/agents/ag_1')
  assert.deepEqual(routeOf(threadRoute({ agentId: 'ag_1', threadId: 'th 2' })), { page: 'agent', agentId: 'ag_1', dialog: undefined, detail: undefined, threadId: 'th 2' })
  assert.deepEqual(routeOf('/agents/ag_1/threads'), { page: 'agent', agentId: 'ag_1', dialog: 'threads', detail: undefined })
  assert.deepEqual(routeOf('/agents/ag_1/notify'), { page: 'agent', agentId: 'ag_1', dialog: 'notify', detail: undefined })
})
