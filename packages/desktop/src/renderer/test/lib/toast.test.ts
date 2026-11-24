import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plainError } from '../../src/lib/toast.ts'

test('an API error body reads as its sentence, and anything else stays as it is', () => {
  assert.equal(plainError('{"error":{"type":"invalid_request_error","message":"That agent doesn’t run on this computer."}}'), 'That agent doesn’t run on this computer.')
  assert.equal(plainError('Failed to fetch'), 'Failed to fetch')
  assert.equal(plainError('{"other":1}'), '{"other":1}')
})
