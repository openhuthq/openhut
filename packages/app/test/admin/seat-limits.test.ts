import { test } from 'node:test'
import assert from 'node:assert/strict'
import { limitsFrom } from '../../src/admin/seat-limits.ts'

test('the seat\'s limits come from the unified rate-limit headers, only the windows Claude reports', () => {
  const headers = new Headers({
    'anthropic-ratelimit-unified-7d-utilization': '0.64',
    'anthropic-ratelimit-unified-7d-reset': '1794693600',
    'anthropic-ratelimit-unified-status': 'allowed',
  })
  assert.deepEqual(limitsFrom(headers), [{ kind: 'seven_day', percent: 64, resetsAt: '2026-11-14T22:00:00.000Z' }])
  assert.deepEqual(limitsFrom(new Headers({ 'anthropic-ratelimit-unified-5h-utilization': '0.051' })), [{ kind: 'five_hour', percent: 5, resetsAt: null }])
  assert.deepEqual(limitsFrom(new Headers()), [])
})
