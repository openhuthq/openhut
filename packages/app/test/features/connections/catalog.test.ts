import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chipMarks, connectedFirst, INTEGRATIONS, SHELVES, uniqueName } from '../../../src/features/connections/catalog.ts'

test('a new connection takes the service name, numbered when that name is taken', () => {
  assert.equal(uniqueName({ title: 'Linear', taken: [] }), 'Linear')
  assert.equal(uniqueName({ title: 'Linear', taken: ['Linear'] }), 'Linear 2')
  assert.equal(uniqueName({ title: 'Linear', taken: ['Linear', 'Linear 2'] }), 'Linear 3')
})

test('every app in Connect apps has a one-line noun description with no full stop', () => {
  for (const item of SHELVES.flatMap((shelf) => shelf.items)) {
    assert.ok(item.short.length <= 38, `${item.title}: "${item.short}" is too long for one line`)
    assert.ok(!item.short.endsWith('.'), `${item.title}: "${item.short}" ends with a full stop`)
    assert.ok(!item.short.includes('as you'), `${item.title}: "${item.short}" says "as you"`)
  }
})

test('connected apps sort to the top of Apps, the rest keep their order', () => {
  const names = connectedFirst({ items: INTEGRATIONS, kinds: ['gmail', 'github'] }).map(({ name }) => name)
  assert.deepEqual(names.slice(0, 2), INTEGRATIONS.map(({ name }) => name).filter((name) => name === 'gmail' || name === 'github'))
  assert.equal(names.length, INTEGRATIONS.length)
})

test('the sidebar chip shows only connected apps: none with nothing connected, at most 3 then +N', () => {
  assert.deepEqual(chipMarks([]), { shown: [], more: 0 })
  assert.deepEqual(chipMarks(['gmail', 'gmail', 'drive']), { shown: ['gmail', 'drive'], more: 0 })
  assert.deepEqual(chipMarks(['gmail', 'drive', 'github', 'linear', 'postgres']), { shown: ['gmail', 'drive', 'github'], more: 2 })
})
