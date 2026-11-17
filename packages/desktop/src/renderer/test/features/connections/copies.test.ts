import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connectionOf, copyOn, holds } from '../../../src/features/connections/copies.ts'

const linear = { name: 'Linear', computers: [{ computer: 'local', id: 'cn_mac' }, { computer: 'beelink', id: 'cn_box' }] }

test('a grant on any computer matches the one connection that holds that copy', () => {
  assert.equal(holds({ connection: linear, id: 'cn_box' }), true)
  assert.equal(holds({ connection: linear, id: 'cn_other' }), false)
  assert.equal(connectionOf({ connections: [linear], id: 'cn_box' })?.name, 'Linear')
  assert.equal(copyOn({ connection: linear, computer: 'beelink' }), 'cn_box')
  assert.equal(copyOn({ connection: linear, computer: 'nuc' }), undefined)
})
