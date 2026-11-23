import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tabsFor } from '../../../src/features/settings/tabs.ts'

const names = (input: { phone: boolean; desktop: boolean }) => tabsFor(input).map(({ name }) => name)

test('settings is one flat list ordered by use, with Team as a plain item', () => {
  assert.deepEqual(names({ phone: false, desktop: true }), ['Account', 'Team', 'Computers', 'Models', 'MCP', 'General', 'Updates'])
})

test('the browser has no Updates and the phone has no MCP, and nobody has Phones', () => {
  assert.deepEqual(names({ phone: false, desktop: false }), ['Account', 'Team', 'Computers', 'Models', 'MCP', 'General'])
  assert.deepEqual(names({ phone: true, desktop: false }), ['Account', 'Team', 'Computers', 'Models', 'General'])
})
