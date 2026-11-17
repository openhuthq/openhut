import { test } from 'node:test'
import assert from 'node:assert/strict'
import { uniqueName } from '../../../src/features/connections/catalog.ts'

test('a new connection takes the service name, numbered when that name is taken', () => {
  assert.equal(uniqueName({ title: 'Linear', taken: [] }), 'Linear')
  assert.equal(uniqueName({ title: 'Linear', taken: ['Linear'] }), 'Linear 2')
  assert.equal(uniqueName({ title: 'Linear', taken: ['Linear', 'Linear 2'] }), 'Linear 3')
})
