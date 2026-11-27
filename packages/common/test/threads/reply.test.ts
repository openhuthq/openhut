import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replyOf, replyText } from '../../src/threads/reply.ts'

test('the reply is the text after the last tool step; text before a step belongs to the work', () => {
  const parts = [{ type: 'text', text: 'I need X' }, { type: 'data-work', data: { calls: [] } }, { type: 'data-step', data: {} }, { type: 'text', text: 'answer' }]
  assert.equal(replyText(parts), 'answer')
  assert.deepEqual(replyOf(parts).notes, ['I need X'])
})

test('a reply with no tool step is all its text, cards and all', () => {
  const parts = [{ type: 'text', text: 'Deploy is ready.' }, { type: 'data-spec', data: {} }, { type: 'text', text: ' Approve?' }]
  assert.equal(replyText(parts), 'Deploy is ready. Approve?')
  assert.deepEqual(replyOf(parts), { notes: [], reply: parts })
})
