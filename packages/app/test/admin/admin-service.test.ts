import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNewer, updateStatus } from '../../src/admin/admin-service.ts'

const startedAt = '2026-11-13T12:00:00.000Z'
const at = (seconds: number) => Date.parse(startedAt) + seconds * 1000

test('a higher version is an update, and so is any other release that is not a version; never for a dev build', () => {
  assert.equal(isNewer({ latest: '0.1.10', current: '0.1.9' }), true)
  assert.equal(isNewer({ latest: '0.2.0', current: '0.1.40' }), true)
  assert.equal(isNewer({ latest: '0.1.9', current: '0.1.10' }), false)
  assert.equal(isNewer({ latest: '0.1.9', current: '0.1.9' }), false)
  assert.equal(isNewer({ latest: '0.1.40', current: '20261113130239' }), true)
  assert.equal(isNewer({ latest: 'e2e-2', current: 'e2e-1' }), true)
  assert.equal(isNewer({ latest: '0.1.40', current: 'dev' }), false)
  assert.equal(isNewer({ latest: null, current: '0.1.40' }), false)
})

test('an update is running while the installer holds the lock, done on a new build, failed otherwise', () => {
  const stored = { from: 'a', startedAt }
  assert.equal(updateStatus({ stored, build: 'a', installing: false, now: at(5) }), 'running')
  assert.equal(updateStatus({ stored, build: 'a', installing: true, now: at(120) }), 'running')
  assert.equal(updateStatus({ stored, build: 'b', installing: true, now: at(30) }), 'done')
  assert.equal(updateStatus({ stored, build: 'a', installing: false, now: at(30) }), 'failed')
  assert.equal(updateStatus({ stored, build: 'a', installing: true, now: at(46 * 60) }), 'failed')
})
