import { test } from 'node:test'
import assert from 'node:assert/strict'
import { saidAfter } from '../../src/lib/said-after.ts'

const user = (text: string) => ({ role: 'user', parts: [{ type: 'text', text }] })
const card = { role: 'assistant', parts: [{ type: 'data-webhook-setup' }] }

test('a card is done once a later user message says Done: <title>', () => {
  const said = saidAfter([user('Done: CI'), card, user('hi'), card, user('Done: CI'), card])
  assert.equal(said(1, 'Done: CI'), true)
  assert.equal(said(3, 'Done: CI'), true)
  assert.equal(said(5, 'Done: CI'), false)
  assert.equal(said(1, 'Done: Other'), false)
})
