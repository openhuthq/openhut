import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callOf, payloadOf } from '../../../src/features/webhooks/call.ts'

test('a webhook call shows its label and keeps the payload behind the first blank line', () => {
  assert.deepEqual(callOf({ author: 'DigitalOcean alerts', call: { webhookId: 'wh_1', label: 'Triggered · 80%' } }), { webhookId: 'wh_1', label: 'Triggered · 80%' })
  assert.deepEqual(callOf({ author: 'DigitalOcean alerts', call: { webhookId: 'wh_1' } }), { webhookId: 'wh_1' })
  assert.equal(callOf({ author: 'Mo' }), undefined)
  assert.equal(payloadOf('[OpenHut inbox:hd_1] Webhook was called.\n\n{"a":1}\n\n{"b":2}'), '{"a":1}\n\n{"b":2}')
  assert.equal(payloadOf('{"a":1}'), '{"a":1}')
})
