import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AppCall } from '../../../src/server/connections/connection-service.ts'
import { appCall, builtIn, joinCalls, kindOf, labelOf } from '../../../src/server/threads/work.ts'

test('labels come from the MCP title when there is one, else from the tool name, with the app and no raw ids', () => {
  assert.deepEqual(labelOf({ name: 'query', app: 'Postgres' }), { label: 'Query Postgres', past: 'Queried Postgres' })
  assert.deepEqual(labelOf({ name: 'list_teams', app: 'Linear' }), { label: 'List teams in Linear', past: 'Listed teams in Linear' })
  assert.deepEqual(labelOf({ name: 'list_issues', app: 'Linear', title: 'Search Issues' }), { label: 'Search issues in Linear', past: 'Searched issues in Linear' })
  assert.deepEqual(labelOf({ name: 'mcp_invoke_tool', app: 'DigitalOcean' }), { label: 'Use DigitalOcean', past: 'Used DigitalOcean' })
  assert.deepEqual(labelOf({ name: 'mcp_find_tools', app: 'DigitalOcean' }), { label: 'Find tools in DigitalOcean', past: 'Found tools in DigitalOcean' })
  assert.deepEqual(labelOf({ name: 'issue_comment', app: 'GitHub' }), { label: 'Comment on issue in GitHub', past: 'Commented on issue in GitHub' })
  assert.deepEqual(labelOf({ name: 'excalidraw_board', app: 'Excalidraw' }), { label: 'Use Excalidraw board', past: 'Used Excalidraw board' })
  assert.deepEqual(labelOf({ name: 'get_issue', app: 'Linear' }), { label: 'Read issue in Linear', past: 'Read issue in Linear' })
  assert.deepEqual(labelOf({ name: 'createPullRequest', app: 'GitHub' }), { label: 'Create pull request in GitHub', past: 'Created pull request in GitHub' })
})

test('built-in tools have plain labels and a kind; unknown ones are humanized', () => {
  assert.deepEqual(builtIn({ name: 'web_search', input: 'db alerts' }), { tool: 'web_search', app: null, kind: 'read', label: 'Search the web', past: 'Searched the web', input: 'db alerts' })
  assert.deepEqual(builtIn({ name: 'update_self' }), { tool: 'update_self', app: null, kind: 'change', label: 'Change its instructions', past: 'Changed its instructions' })
  assert.equal(builtIn({ name: 'browser_click' }).past, 'Used the browser')
  assert.equal(builtIn({ name: 'fetch_weather' }).past, 'Fetched weather')
})

test('kinds follow the app\'s annotations: reads, changes, deletes', () => {
  assert.equal(kindOf({ name: 'query', description: '', schema: {}, annotations: { readOnlyHint: true } }), 'read')
  assert.equal(kindOf({ name: 'create_issue', description: '', schema: {}, annotations: { readOnlyHint: false } }), 'change')
  assert.equal(kindOf({ name: 'drop', description: '', schema: {}, annotations: { destructiveHint: true } }), 'delete')
  assert.equal(kindOf({ name: 'mcp_invoke_tool', description: '', schema: {} }), 'other')
})

const record = (over: Partial<AppCall>): AppCall => ({ at: 0, name: 'postgres_query', connectionId: 'cn_pg', app: 'Postgres', spec: { name: 'query', description: '', schema: {}, annotations: { readOnlyHint: true } }, args: {}, outcome: 'allowed', ms: 5, ...over })
const chip = (id: string, name: string) => ({ start: 0, name, app: true, call: { id, tool: name, app: null, kind: 'other' as const, label: name, past: name, ms: 0, status: 'running' as const } })

test('each call joins its own outcome by its tool call id, in order, so repeats keep their own outcome and error', () => {
  const calls = joinCalls({
    chips: [chip('a', 'postgres_query'), chip('b', 'postgres_query'), chip('c', 'digitalocean_list_droplets'), { ...chip('d', 'web_search'), app: false }],
    records: [
      record({ output: '214', args: { sql: 'select 1' } }),
      record({ outcome: 'failed', error: 'connect ETIMEDOUT', ms: 5000 }),
      record({ name: 'digitalocean_list_droplets', app: 'DigitalOcean', connectionId: 'cn_do', outcome: 'denied', error: 'Set to Never in DigitalOcean.', spec: { name: 'list_droplets', description: '', schema: {}, annotations: { readOnlyHint: true } } }),
      record({ name: 'linear_list_teams', app: 'Linear', connectionId: 'cn_ln', spec: { name: 'list_teams', description: '', schema: {}, annotations: { readOnlyHint: true } } }),
    ],
  })
  assert.deepEqual(calls.map((call) => [call.id, call.past, call.status, call.error ?? call.output ?? '', call.ms]), [
    ['a', 'Queried Postgres', 'done', '214', 5],
    ['b', 'Queried Postgres', 'failed', 'connect ETIMEDOUT', 5000],
    ['c', 'Listed droplets in DigitalOcean', 'blocked', 'Set to Never in DigitalOcean.', 5],
    ['d', 'web_search', 'running', '', 0],
    ['call0', 'Listed teams in Linear', 'done', '', 5],
  ])
  assert.equal(calls[0].input, '{\n  "sql": "select 1"\n}')
  assert.equal(calls[2].connectionId, 'cn_do')
})

test('an asked call waits on the person', () => {
  assert.equal(joinCalls({ chips: [], records: [record({ outcome: 'asked' })] })[0].status, 'asked')
})

test('a call through a catch-all tool takes its label and kind from the inner action, not the gateway tool', () => {
  const call = appCall(record({
    name: 'digitalocean_mcp_invoke_tool', app: 'DigitalOcean', connectionId: 'cn_do', args: { name: 'databases/db-cluster-list' },
    spec: { name: 'mcp_invoke_tool', description: '', schema: {} },
    action: { spec: { name: 'databases/db-cluster-list', description: 'List databases', schema: {}, annotations: { readOnlyHint: true } }, label: 'List databases' },
  }))
  assert.deepEqual([call.tool, call.label, call.past, call.kind], ['databases/db-cluster-list', 'List databases in DigitalOcean', 'Listed databases in DigitalOcean', 'read'])
})
