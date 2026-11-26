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
