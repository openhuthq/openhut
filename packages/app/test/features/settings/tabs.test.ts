import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tabsFor } from '../../../src/features/settings/tabs.ts'

const names = () => tabsFor().map(({ name }) => name)

test('settings is one flat list: General first, then People; Apps sits between Models and Updates', () => {
  assert.deepEqual(names(), ['General', 'People', 'Computers', 'Models', 'Apps', 'Updates'])
})

test('every settings page says what it is for in one line', () => {
  for (const tab of tabsFor()) assert.ok(tab.subtitle && !tab.subtitle.includes('\n'), tab.name)
})

test('Apps is the connections window, so the sidebar chip and Settings open the same page', () => {
  assert.equal(tabsFor().find(({ slug }) => slug === 'apps')?.href, '/connections')
})
