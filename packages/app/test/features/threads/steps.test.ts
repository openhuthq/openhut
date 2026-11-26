import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ToolCall } from '@openhut/common/threads/thread.ts'
import { attachCalls, durationOf, errorUnder, kindOf, legacyWork, splitLive, withoutCards, stepsOf, summaryOf, troubleOf } from '../../../src/features/threads/steps.ts'

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

const call = (past: string, over: Partial<ToolCall> = {}): ToolCall => ({ id: past + Math.random(), tool: 'query', app: 'Postgres', kind: 'read', label: past.replace(/^Queried/, 'Query'), past, ms: 10, status: 'done', ...over })

test('the summary is past tense, grouped, changes first, at most two clauses and "and N more"', () => {
  assert.equal(summaryOf({ calls: [call('Queried Postgres')], ms: 0 }), 'Queried Postgres')
  assert.equal(summaryOf({ calls: [call('Queried Postgres'), call('Queried Postgres'), call('Queried Postgres')], ms: 0 }), 'Queried Postgres 3 times')
  assert.equal(summaryOf({ calls: [call('Searched issues in Linear'), call('Created issue in Linear', { kind: 'change' })], ms: 0 }), 'Created issue in Linear and searched issues in Linear')
  assert.equal(summaryOf({ calls: [call('Queried Postgres'), call('Queried Postgres'), call('Read CPU in DigitalOcean'), call('Searched the web'), call('Opened pull request in GitHub', { kind: 'change' })], ms: 0 }), 'Opened pull request in GitHub, queried Postgres twice and 2 more')
  assert.equal(summaryOf({ calls: [call('Deleted branch in GitHub', { kind: 'delete' }), call('Updated issue in Linear', { kind: 'change' })], ms: 0 }), 'Deleted branch in GitHub and updated issue in Linear')
})

test('failed and blocked calls are counted apart and left out of the sentence; a turn of only those says what it tried', () => {
  const work = { calls: [call('Listed projects in DigitalOcean'), call('Listed droplets in DigitalOcean', { status: 'blocked', label: 'List droplets in DigitalOcean', error: 'Set to Never in DigitalOcean.' }), call('Queried Postgres', { status: 'failed', error: 'connect ETIMEDOUT' })], ms: 0 }
  assert.equal(summaryOf(work), 'Listed projects in DigitalOcean')
  assert.deepEqual(troubleOf(work), { failed: 1, blocked: 1 })
  const tried = { calls: [call('Queried Postgres', { status: 'failed', error: 'connect ETIMEDOUT' })], ms: 0 }
  assert.equal(summaryOf(tried), 'Tried to query Postgres')
})

test('durations read as seconds or minutes', () => {
  assert.equal(durationOf(14_200), '14s')
  assert.equal(durationOf(72_000), '1m 12s')
})

test('older replies (tool chips plus gateway calls) become the same work, one call per repeat, blocked kept apart from failed', () => {
  const work = legacyWork({
    events: [{ tool: 'call_tool', label: 'postgres_query' }, { tool: 'call_tool', label: 'postgres_query' }, { tool: 'get_self' }],
    calls: [{ tool: 'postgres_query', connectionName: 'Postgres', outcome: 'failed', reason: 'Diagnose', ms: 5053 }, { tool: 'mcp_invoke_tool', connectionName: 'DigitalOcean', outcome: 'denied', reason: 'Find it', ms: 0 }],
  })
  assert.deepEqual(work?.calls.map((each) => [each.past, each.status, each.app, each.error]), [
    ['Checked postgres', 'failed', 'Postgres', undefined],
    ['Checked postgres', 'failed', 'Postgres', undefined],
    ['Invoke', 'blocked', 'DigitalOcean', undefined],
  ])
  assert.equal(legacyWork({ events: [{ tool: 'get_self' }], calls: [] }), undefined)
})

test('a call whose ask shows as its own card is left out of the work line; a turn of only those has no line', () => {
  const call = (id: string, status: ToolCall['status']): ToolCall => ({ id, tool: id, app: null, kind: 'other', label: id, past: id, ms: 1, status })
  const work = { ms: 1, calls: [call('connect_app', 'asked'), call('terminal', 'done'), call('call_tool', 'asked')] }
  assert.deepEqual(withoutCards(work)?.calls.map((each) => each.tool), ['terminal'])
  assert.equal(summaryOf(withoutCards(work) ?? work), 'terminal')
  assert.equal(withoutCards({ ms: 1, calls: [call('connect_app', 'asked'), call('update_self', 'asked')] }), undefined)
  assert.equal(withoutCards({ ms: 1, calls: [call('connect_app', 'asked')], error: 'Model failed' })?.error, 'Model failed')
})

test('while the turn runs, the finished calls stay folded and only the newest running call is the live line', () => {
  const call = (id: string, status: ToolCall['status']): ToolCall => ({ id, tool: 'terminal', app: null, kind: 'other', label: `Run ${id}`, past: `Ran ${id}`, ms: 1, status })
  const work = { ms: 1, calls: [call('a', 'done'), call('b', 'running'), call('c', 'running')] }
  const during = splitLive({ work, live: true })
  assert.equal(during.running?.id, 'c')
  assert.deepEqual(during.finished.calls.map((each) => each.id), ['a'])
  const after = splitLive({ work, live: false })
  assert.equal(after.running, undefined)
  assert.equal(after.finished, work)
})

test('a turn with nothing to say shows no "No reply" line; a failed turn shows its error under the reply unless the work line already holds it', () => {
  const ran: ToolCall = { id: 'a', tool: 'terminal', app: null, kind: 'other', label: 'Run a command', past: 'Ran a command', ms: 1, status: 'done' }
  assert.equal(errorUnder({ work: undefined, answered: false }), undefined)
  assert.equal(errorUnder({ work: { ms: 1, calls: [ran] }, answered: false }), undefined)
  assert.equal(errorUnder({ work: { ms: 1, calls: [ran], error: 'Overloaded' }, answered: false }), 'Overloaded')
  assert.equal(errorUnder({ work: { ms: 1, calls: [ran], error: 'Overloaded' }, answered: true }), undefined)
  assert.equal(errorUnder({ work: { ms: 1, calls: [], error: 'Overloaded' }, answered: true }), 'Overloaded')
})
