import { test } from 'node:test'
import assert from 'node:assert/strict'
import { brandColor, callOf, initialsOf, payloadOf, pretty, statusLabel, tileOf, toneOf } from '../../../src/features/webhooks/call.ts'

test('a webhook call shows its label and keeps the payload behind the first blank line', () => {
  assert.deepEqual(callOf({ author: 'DigitalOcean alerts', call: { webhookId: 'wh_1', label: 'Triggered · 80%' } }), { webhookId: 'wh_1', label: 'Triggered · 80%' })
  assert.deepEqual(callOf({ author: 'DigitalOcean alerts', call: { webhookId: 'wh_1' } }), { webhookId: 'wh_1' })
  assert.equal(callOf({ author: 'Mo' }), undefined)
  assert.equal(payloadOf('[OpenHut inbox:hd_1] Webhook was called.\n\n{"a":1}\n\n{"b":2}'), '{"a":1}\n\n{"b":2}')
  assert.equal(payloadOf('{"a":1}'), '{"a":1}')
})

test('a call reads its card, its batch and how often it was seen', () => {
  const call = callOf({ call: { webhookId: 'wh_1', seen: 2, card: { title: 'CPU is running high', status: 'recovered', icon: { path: 'M0 0', hex: '0080FF' } }, calls: [{ status: 'triggered', details: '80%', at: '2026-11-26T21:00:00Z', seen: 2 }, { status: 'recovered', details: '0%', at: '2026-11-26T21:14:00Z' }] } })
  assert.equal(call?.card?.title, 'CPU is running high')
  assert.equal(call?.calls?.length, 2)
  assert.equal(call?.seen, 2)
})

test('a call without a card keeps the plain bubble', () => {
  assert.equal(callOf({ call: { webhookId: 'wh_1' } })?.card, undefined)
  assert.equal(callOf({ call: { webhookId: 'wh_1', card: { status: 'failed' } } }), undefined)
})

test('a status picks its colour and reads as a word', () => {
  for (const status of ['success', 'completed', 'Resolved', 'passed', 'recovered']) assert.equal(toneOf(status), 'green')
  for (const status of ['failure', 'failed', 'error', 'alert', 'TRIGGERED', 'critical']) assert.equal(toneOf(status), 'red')
  for (const status of ['in_progress', 'in progress', 'queued', 'pending']) assert.equal(toneOf(status), 'amber')
  for (const status of ['cancelled', 'skipped', 'neutral', '']) assert.equal(toneOf(status), 'grey')
  assert.equal(statusLabel('in_progress'), 'In progress')
  assert.equal(statusLabel('success'), 'Success')
})

test('a logo tile tints the brand colour, grey for dark logos, initials without one', () => {
  assert.equal(brandColor('0080FF'), '#0080ff')
  assert.equal(brandColor('#181717'), '#181717')
  assert.equal(brandColor('red; background: url(x)'), undefined)
  assert.equal(tileOf('#181717'), '#f3f3f4')
  assert.equal(tileOf('#0080ff'), 'color-mix(in srgb, #0080ff 10%, white)')
  assert.equal(initialsOf('DigitalOcean Postgres alerts'), 'DP')
  assert.equal(initialsOf(''), '?')
})

test('pretty indents a JSON payload and leaves anything else as sent', () => {
  assert.equal(pretty('{"a":{"b":1}}'), '{\n  "a": {\n    "b": 1\n  }\n}')
  assert.equal(pretty('not json'), 'not json')
})
