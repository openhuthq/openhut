import { test } from 'node:test'
import assert from 'node:assert/strict'
import { permissions } from '../../../src/server/permissions/permissions.ts'
import type { ToolSpec } from '../../../src/server/integrations/connector.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'

const DO = 'mcp.digitalocean.com/registry'
const spec = (extra: Partial<ToolSpec>): ToolSpec => ({ name: 'tool', description: '', schema: {}, ...extra })

test('defaults come from the tool labels, and risky tools never default to Always allow', () => {
  const table: [string, Partial<ToolSpec>, string, string][] = [
    ['read-only', { annotations: { readOnlyHint: true } }, 'read', 'allow'],
    ['unlabeled', {}, 'other', 'ask'],
    ['labeled write', { annotations: { readOnlyHint: false, destructiveHint: false } }, 'update', 'ask'],
    ['destructive', { annotations: { destructiveHint: true } }, 'delete', 'deny'],
    ['DigitalOcean create', { annotations: { destructiveHint: false }, meta: { [DO]: { operation: 'create', risk: 'medium' } } }, 'create', 'ask'],
    ['DigitalOcean update, high risk', { annotations: { destructiveHint: false }, meta: { [DO]: { operation: 'update', risk: 'high' } } }, 'update', 'deny'],
    ['DigitalOcean read, high risk', { annotations: { readOnlyHint: true }, meta: { [DO]: { operation: 'read', risk: 'high' } } }, 'read', 'deny'],
    ['DigitalOcean delete', { annotations: { destructiveHint: true }, meta: { [DO]: { operation: 'delete', risk: 'high' } } }, 'delete', 'deny'],
    ['top-level operation', { meta: { operation: 'delete' } }, 'delete', 'deny'],
    ['catch-all invoke tool', { name: 'mcp_invoke_tool', annotations: { readOnlyHint: false, destructiveHint: true } }, 'other', 'ask'],
    ['catch-all call tool, unlabeled', { name: 'call-tool' }, 'other', 'ask'],
    ['catch-all marked read-only', { name: 'invoke_tool', annotations: { readOnlyHint: true } }, 'read', 'allow'],
    ['named like one but labeled delete', { name: 'run_tool', meta: { operation: 'delete' } }, 'delete', 'deny'],
    ['a tool that only looks tools up', { name: 'mcp_find_tools', annotations: { readOnlyHint: true } }, 'read', 'allow'],
    ['tool lookup with no labels', { name: 'mcp_find_tools' }, 'read', 'allow'],
    ['schema lookup with no labels', { name: 'retrieve_tool_schema' }, 'read', 'allow'],
    ['describe with no labels', { name: 'describeTools' }, 'read', 'allow'],
    ['a top-level tool named like a read keeps its labels', { name: 'apps/app-list' }, 'other', 'ask'],
    ['Linear save issue, labeled destructive', { name: 'save_issue', annotations: { readOnlyHint: false, destructiveHint: true } }, 'create', 'ask'],
    ['Linear save comment', { name: 'save_comment', annotations: { destructiveHint: true } }, 'create', 'ask'],
    ['save labeled delete stays a delete', { name: 'save_issue', meta: { operation: 'delete' } }, 'delete', 'deny'],
  ]
  for (const [label, extra, group, permission] of table) {
    assert.equal(permissions.groupOf(spec(extra)), group, label)
    assert.equal(permissions.defaultOf(spec(extra)), permission, label)
  }
})

test('a catch-all tool leaves the list; its inner actions sit under their groups, with one "any other" entry per group', () => {
  const specs = [spec({ name: 'mcp_find_tools', annotations: { readOnlyHint: true } }), spec({ name: 'mcp_invoke_tool', annotations: { destructiveHint: true } })]
  const seen = spec({ name: 'databases/db-cluster-list', annotations: { readOnlyHint: true } })
  const actions = permissions.actions({ specs, discovered: [seen] })
  assert.deepEqual(actions.map((each) => [each.name, permissions.groupOf(each), permissions.defaultOf(each)]), [
    ['mcp_find_tools', 'read', 'allow'], ['databases/db-cluster-list', 'read', 'allow'],
    ['*read', 'read', 'allow'], ['*update', 'update', 'ask'], ['*delete', 'delete', 'deny'], ['*other', 'other', 'ask'],
  ])
  assert.deepEqual(permissions.actions({ specs: specs.slice(0, 1), discovered: [seen] }), specs.slice(0, 1))
})

test('an inner action takes its own setting, else its group\'s, else its default; unlabeled ones ask', async () => {
  await migrate()
  await db.insertInto('person').values({ id: 'usr_permsunit', email: 'unit@example.com', role: 'owner', removed_at: null }).execute()
  await db.insertInto('agent').values({ id: 'ag_permsunit', name: 'Unit', owner_id: 'usr_permsunit', instructions: '#', model: 'claude:sonnet', net: 75, channel_key: 'k', wanted: 'stopped' }).execute()
  await db.insertInto('connection').values({ id: 'cn_permsunit1', kind: 'mcp', name: 'DigitalOcean', owner_id: 'usr_permsunit', config: '{}' }).execute()
  const actor = { id: 'usr_permsunit', email: 'unit@example.com', role: 'owner' as const }
  const at = { agentId: 'ag_permsunit', connectionId: 'cn_permsunit1' }
  const read = spec({ name: 'databases/db-cluster-list', annotations: { readOnlyHint: true } })
  const remove = spec({ name: 'databases/db-cluster-delete', annotations: { destructiveHint: true } })
  const unknown = spec({ name: 'apps/app-mystery' })
  const decide = (each: ToolSpec) => permissions.decide({ ...at, spec: each })
  assert.deepEqual([await decide(read), await decide(remove), await decide(unknown)], ['allow', 'deny', 'ask'])
  await permissions.set({ actor, ...at, tools: ['*delete'], state: 'ask' })
  await permissions.set({ actor, ...at, tools: ['*read'], state: 'deny' })
  assert.deepEqual([await decide(read), await decide(remove)], ['deny', 'ask'])
  await permissions.set({ actor, ...at, tools: [read.name], state: 'allow' })
  assert.equal(await decide(read), 'allow')
  await db.deleteFrom('tool_permission').where('agent_id', '=', at.agentId).execute()
})

test('an inner action with no labels is a read by its verb, and only then', () => {
  const table: [string, Partial<ToolSpec>, string, string][] = [
    ['get', { name: 'databases/db-cluster-get' }, 'read', 'allow'],
    ['list', { name: 'apps/app-list' }, 'read', 'allow'],
    ['camel case fetch', { name: 'fetchInvoices' }, 'read', 'allow'],
    ['a read and a write', { name: 'get_or_create_project' }, 'other', 'ask'],
    ['a write', { name: 'apps/app-restart' }, 'other', 'ask'],
    ['a query is not a listed verb', { name: 'insights/insights-query' }, 'other', 'ask'],
    ['labeled not read-only', { name: 'get_report', annotations: { readOnlyHint: false } }, 'update', 'ask'],
    ['labeled destructive', { name: 'fetch_and_purge', annotations: { destructiveHint: true } }, 'delete', 'deny'],
    ['labeled by operation', { name: 'list_and_wipe', meta: { operation: 'delete' } }, 'delete', 'deny'],
  ]
  for (const [label, extra, group, permission] of table) {
    assert.equal(permissions.groupOf(permissions.byVerb(spec(extra))), group, label)
    assert.equal(permissions.defaultOf(permissions.byVerb(spec(extra))), permission, label)
  }
})

test('a DigitalOcean health check asks nothing: discovery and unlabeled reads run', () => {
  const discovery = ['mcp_find_tools', 'retrieve_tool_schema', 'describeTools'].filter((name) => permissions.defaultOf(spec({ name })) !== 'allow')
  const reads = ['databases/db-cluster-list', 'databases/db-cluster-get', 'apps/app-list', 'apps/app-get-logs', 'droplets/droplet-list', 'monitoring/get-droplet-cpu-metrics']
    .filter((name) => permissions.defaultOf(permissions.byVerb(spec({ name }))) !== 'allow')
  assert.deepEqual([...discovery, ...reads], [])
})

test('a call can\'t be undone when it is labeled destructive, or is an unlabeled delete by its verb', () => {
  const table: [Partial<ToolSpec>, boolean][] = [
    [{ name: 'databases/db-cluster-delete' }, true],
    [{ name: 'removeMember' }, true],
    [{ name: 'update_page', annotations: { destructiveHint: true } }, true],
    [{ name: 'run', meta: { operation: 'delete' } }, true],
    [{ name: 'delete_draft', annotations: { readOnlyHint: false, destructiveHint: false } }, false],
    [{ name: 'apps/app-list' }, false],
  ]
  for (const [extra, undoable] of table) assert.equal(permissions.undoable(spec(extra)), undoable, String(extra.name))
})

test('saving a new thing can be undone; saving over one with an id can\'t', () => {
  const save = spec({ name: 'save_issue', annotations: { destructiveHint: true } })
  assert.equal(permissions.undoable(save, { title: 'Flaky CI' }), false)
  assert.equal(permissions.undoable(save, { id: 'ENG-12', title: 'Flaky CI' }), true)
})
