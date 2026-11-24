import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tabsFor } from '../../../src/features/settings/tabs.ts'

const names = () => tabsFor().map(({ name }) => name)

test('settings is one flat list: General first, holding the team and your account, then People; Phones is coming; there is no MCP', () => {
  assert.deepEqual(names(), ['General', 'People', 'Computers', 'Phones', 'Models', 'Updates'])
})
