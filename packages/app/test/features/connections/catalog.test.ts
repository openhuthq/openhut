import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SHELVES, uniqueName } from '../../../src/features/connections/catalog.ts'

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
