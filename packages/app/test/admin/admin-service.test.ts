import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewer, updateStatus } from '../../src/admin/admin-service.ts'

const startedAt = '2026-11-13T12:00:00.000Z'
const at = (seconds: number) => Date.parse(startedAt) + seconds * 1000

test('a different build is an update, unless it is older or this is a dev build', () => {
  assert.equal(isNewer({ latest: '20261113140000', current: '20261113130239' }), true)
  assert.equal(isNewer({ latest: '20261113130239', current: '20261113140000' }), false)
  assert.equal(isNewer({ latest: '20261113130239', current: '20261113130239' }), false)
  assert.equal(isNewer({ latest: 'e2e-2', current: 'e2e-1' }), true)
  assert.equal(isNewer({ latest: '20261113130239', current: 'dev' }), false)
  assert.equal(isNewer({ latest: null, current: '20261113130239' }), false)
})

test('an update is running while the installer holds the lock, done on a new build, failed otherwise', () => {
  const stored = { from: 'a', startedAt }
  assert.equal(updateStatus({ stored, build: 'a', installing: false, now: at(5) }), 'running')
  assert.equal(updateStatus({ stored, build: 'a', installing: true, now: at(120) }), 'running')
  assert.equal(updateStatus({ stored, build: 'b', installing: true, now: at(30) }), 'done')
  assert.equal(updateStatus({ stored, build: 'a', installing: false, now: at(30) }), 'failed')
  assert.equal(updateStatus({ stored, build: 'a', installing: true, now: at(46 * 60) }), 'failed')
})
