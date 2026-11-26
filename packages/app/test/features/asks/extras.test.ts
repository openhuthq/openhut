import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineDiff, needsQrScan, undoable, webhookOf } from '../../../src/features/asks/extras.ts'

test('update_self shows the instructions diff: removed lines struck, new lines added, kept lines plain', () => {
  assert.deepEqual(lineDiff({ before: '# Dev\nAnswer briefly.\n', after: '# Dev\nWatch the inbox.' }), [
    { kind: 'gone', text: 'Answer briefly.' },
    { kind: 'same', text: '# Dev' },
    { kind: 'added', text: 'Watch the inbox.' },
  ])
})

test('add_channel shows the QR step only once WhatsApp is approved', () => {
  assert.equal(needsQrScan({ status: 'done', input: { kind: 'whatsapp' } }), true)
  assert.equal(needsQrScan({ status: 'open', input: { kind: 'whatsapp' } }), false)
  assert.equal(needsQrScan({ status: 'done', input: { kind: 'telegram' } }), false)
})

test('call_tool warns that a destructive action can\'t be undone, by its action name first', () => {
  assert.equal(undoable({ input: { tool: 'delete_issue' } }), true)
  assert.equal(undoable({ input: { tool: 'run', action: { name: 'drop_table', label: 'Drop' } } }), true)
  assert.equal(undoable({ input: { tool: 'list_issues' } }), false)
})

test('add_webhook finds the newest webhook with the asked name, once approved', () => {
  const webhooks = [{ id: 'wh_1', name: 'Alerts' }, { id: 'wh_2', name: 'Other' }, { id: 'wh_3', name: 'Alerts' }]
  assert.equal(webhookOf({ ask: { status: 'done', input: { name: 'Alerts' } }, webhooks })?.id, 'wh_3')
  assert.equal(webhookOf({ ask: { status: 'open', input: { name: 'Alerts' } }, webhooks }), undefined)
})
