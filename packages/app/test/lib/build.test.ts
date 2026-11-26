import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStale, noteBuild } from '../../src/lib/build.ts'

test('a tab goes stale once the server answers with a build other than the one it loaded with', () => {
  assert.equal(noteBuild(null), false)
  assert.equal(noteBuild('613'), false)
  assert.equal(noteBuild('613'), false)
  assert.equal(isStale(), false)
  assert.equal(noteBuild('614'), true)
  assert.equal(isStale(), true)
  assert.equal(noteBuild('615'), false)
  assert.equal(noteBuild('613'), false)
  assert.equal(isStale(), true)
})
