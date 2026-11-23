import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tabsFor } from '../../../src/features/settings/tabs.ts'

const names = (input: { desktop: boolean }) => tabsFor(input).map(({ name }) => name)

test('settings is one flat list ordered by use; the team lives in General and there is no MCP', () => {
  assert.deepEqual(names({ desktop: true }), ['Account', 'Computers', 'Models', 'General', 'Updates'])
})

test('the browser has no Updates', () => {
  assert.deepEqual(names({ desktop: false }), ['Account', 'Computers', 'Models', 'General'])
})
