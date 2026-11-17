import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachCalls, kindOf, stepsOf } from '../../../src/features/threads/steps.ts'

test('pairs Hermes start and finish events, merges repeats and names call_tool by its app tool', () => {
  const steps = stepsOf([
    { tool: 'mcp__openhut__list_tools', label: 'mcp__openhut__list_tools', toolCallId: 'a', status: 'running' },
    { tool: 'mcp__openhut__list_tools', toolCallId: 'a', status: 'completed' },
    { tool: 'mcp__openhut__list_tools', label: 'mcp__openhut__list_tools', toolCallId: 'b', status: 'running' },
    { tool: 'mcp__openhut__list_tools', toolCallId: 'b', status: 'completed' },
    { tool: 'mcp__openhut__call_tool', label: 'excalidraw_draw', toolCallId: 'c', status: 'running' },
    { tool: 'execute_code', label: 'import subprocess print(1)', toolCallId: 'd', status: 'running' },
  ])
  assert.deepEqual(steps.map(({ title, count, done, detail }) => ({ title, count, done, detail })), [
    { title: 'list_tools', count: 2, done: true, detail: undefined },
    { title: 'excalidraw_draw', count: 1, done: false, detail: undefined },
    { title: 'execute_code', count: 1, done: false, detail: 'import subprocess print(1)' },
  ])
  assert.equal(kindOf(steps[1].tool), 'app')
  assert.equal(kindOf(steps[2].tool), 'code')
  const left = attachCalls({ steps, calls: [{ tool: 'excalidraw_draw', connectionName: 'Excalidraw', outcome: 'allowed', reason: '', ms: 411 }, { tool: 'postgres_query', connectionName: 'DB', outcome: 'denied', reason: 'No grant.', ms: 3 }] })
  assert.equal(steps[1].call?.ms, 411)
  assert.deepEqual(left.map((call) => call.tool), ['postgres_query'])
})

test('reads events without ids, as older replies stored them', () => {
  assert.deepEqual(stepsOf([{ tool: 'call_tool', label: 'postgres_query' }]).map((step) => step.title), ['postgres_query'])
})
