import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachCalls, kindOf, stepsOf } from '../../../src/features/threads/steps.ts'

test('pairs Hermes start and finish events, merges repeats and names call_tool by its app tool', () => {
  const steps = stepsOf([
    { tool: 'mcp__openhut__update_self', label: 'mcp__openhut__update_self', toolCallId: 'a', status: 'running' },
    { tool: 'mcp__openhut__update_self', toolCallId: 'a', status: 'completed' },
    { tool: 'mcp__openhut__update_self', label: 'mcp__openhut__update_self', toolCallId: 'b', status: 'running' },
    { tool: 'mcp__openhut__update_self', toolCallId: 'b', status: 'completed' },
    { tool: 'mcp__openhut__call_tool', label: 'excalidraw_draw', toolCallId: 'c', status: 'running' },
    { tool: 'execute_code', label: 'import subprocess print(1)', toolCallId: 'd', status: 'running' },
  ])
  assert.deepEqual(steps.map(({ title, count, done, detail }) => ({ title, count, done, detail })), [
    { title: 'update_self', count: 2, done: true, detail: undefined },
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
  assert.deepEqual(stepsOf([{ tool: 'mcp__openhut__ask_to_connect', label: 'Cloudflare' }]).map((step) => [step.title, step.detail]), [['ask_to_connect', undefined]])
})

test('hides the agent\'s own get_self, list_tools and describe_tool steps and their calls', () => {
  assert.deepEqual(stepsOf([
    { tool: 'mcp__openhut__get_self', label: 'mcp__openhut__get_self', toolCallId: 'a', status: 'running' },
    { tool: 'mcp__openhut__get_self', toolCallId: 'a', status: 'completed' },
    { tool: 'list_tools', status: 'completed' },
    { tool: 'mcp__openhut__describe_tool', label: 'linear_list_teams', toolCallId: 'b', status: 'completed' },
  ]), [])
  const steps = stepsOf([
    { tool: 'get_self', status: 'completed' },
    { tool: 'mcp__openhut__call_tool', label: 'linear_list_teams', toolCallId: 'c', status: 'completed' },
  ])
  assert.deepEqual(steps.map((step) => step.title), ['linear_list_teams'])
  const left = attachCalls({ steps, calls: [{ tool: 'get_self', connectionName: '', outcome: 'allowed', reason: '', ms: 2 }, { tool: 'linear_list_teams', connectionName: 'Linear', outcome: 'allowed', reason: '', ms: 323 }] })
  assert.deepEqual(left, [])
  assert.equal(steps[0].call?.ms, 323)
})
