import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewer } from '../../src/admin/admin-service.ts'

test('only a later timestamp build counts as an update', () => {
  assert.equal(isNewer({ latest: '20261113140000', current: '20261113130239' }), true)
  assert.equal(isNewer({ latest: '20261113130239', current: '20261113130239' }), false)
  assert.equal(isNewer({ latest: '20261113130239', current: 'dev' }), false)
  assert.equal(isNewer({ latest: null, current: '20261113130239' }), false)
})
