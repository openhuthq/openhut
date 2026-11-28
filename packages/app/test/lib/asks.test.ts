import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lineDiff, needsQrScan, toolAnswer, toolChoices, toolDetails, toolOutcome, undoable, webhookOf } from '../../src/lib/asks.ts'

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

test('call_tool warns that a destructive action can\'t be undone and offers no Always allow, as the server marked it', () => {
  assert.equal(undoable({ input: { tool: 'run', destructive: true } }), true)
  assert.equal(undoable({ input: { tool: 'delete_issue' } }), false)
  assert.deepEqual(toolChoices({ input: { destructive: true } }), ['once', 'decline'])
  assert.deepEqual(toolChoices({ input: { tool: 'create_issue' } }), ['always', 'once', 'decline'])
})

test('add_webhook finds the newest webhook with the asked name, once approved', () => {
  const webhooks = [{ id: 'wh_1', name: 'Alerts' }, { id: 'wh_2', name: 'Other' }, { id: 'wh_3', name: 'Alerts' }]
  assert.equal(webhookOf({ ask: { status: 'done', input: { name: 'Alerts' } }, webhooks })?.id, 'wh_3')
  assert.equal(webhookOf({ ask: { status: 'open', input: { name: 'Alerts' } }, webhooks }), undefined)
})

test('call_tool: Always allow approves and sets the permission to Always', () => {
  assert.deepEqual(toolAnswer('always'), { verb: 'approvals', body: { answer: { always: true } } })
  assert.equal(toolOutcome({ status: 'done', input: { always: true } }), 'Always allowed')
})

test('call_tool: Allow approves once and leaves the permission alone', () => {
  assert.deepEqual(toolAnswer('once'), { verb: 'approvals', body: { answer: { always: false } } })
  assert.equal(toolOutcome({ status: 'done', input: { always: false } }), 'Allowed once')
})

test('call_tool: Not now declines', () => {
  assert.deepEqual(toolAnswer('decline'), { verb: 'declines', body: {} })
  assert.equal(toolOutcome({ status: 'declined', input: {} }), 'Declined')
  assert.equal(toolOutcome({ status: 'open', input: {} }), undefined)
})

test('call_tool details: the raw tool id, then its arguments', () => {
  assert.deepEqual(toolDetails({ input: { name: 'github_git_push', tool: 'git_push', arguments: {} } }), ['github_git_push'])
  assert.deepEqual(toolDetails({ input: { name: 'mcp_db', arguments: { id: 'x' } } }), ['mcp_db', 'id: x'])
  assert.deepEqual(toolDetails({ input: { name: 'slack_post', arguments: { text: 'Hi\nthere', to: ['#ops'] } } }), ['slack_post', 'text: Hi', 'there', 'to: [', '  "#ops"', ']'])
})
