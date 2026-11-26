import { test } from 'node:test'
import assert from 'node:assert/strict'
import { permissions } from '../../../src/server/permissions/permissions.ts'
import type { ToolSpec } from '../../../src/server/integrations/connector.ts'

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
