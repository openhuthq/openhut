import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLOSED, FREE_POLICY, HELD_POLICY, isInputLine, stillAfter } from '../../src/agentd/browser.ts'

test('only mouse and keyboard input, and the app\'s keep-alive ping, reach the bridge, and only in small lines', () => {
  assert.equal(isInputLine('{"type":"ping"}'), true)
  assert.equal(isInputLine('{"type":"input_mouse","eventType":"mousePressed","x":1,"y":2}'), true)
  assert.equal(isInputLine('{"type":"input_keyboard","eventType":"keyDown","key":"a"}'), true)
  assert.equal(isInputLine('{"type":"command","action":"navigate","url":"http://10.0.0.1/"}'), false)
  assert.equal(isInputLine(`{"type":"input_keyboard","key":"${'a'.repeat(3000)}"}`), false)
  assert.equal(isInputLine('not json'), false)
})

test('while a person holds the browser the agent may look but not act', () => {
  const held = JSON.parse(HELD_POLICY)
  assert.equal(held.default, 'deny')
  for (const look of ['snapshot', 'url', 'title', 'gettext', 'screenshot', 'stream_status']) assert.ok(held.allow.includes(look), look)
  for (const act of ['navigate', 'click', 'fill', 'eval', 'scroll', 'press', 'type']) assert.ok(!held.allow.includes(act), act)
  assert.deepEqual(JSON.parse(FREE_POLICY), { default: 'allow' })
})

test('the cached still follows the live stream: page, then picture; junk is ignored; closed resets it', () => {
  let still = stillAfter(CLOSED, '{"type":"tabs","tabs":[{"active":true,"url":"https://example.com/","title":"Example"}]}')
  assert.deepEqual(still, { open: true, url: 'https://example.com/', title: 'Example', data: '' })
  still = stillAfter(still, '{"type":"frame","data":"/9j/4AAQ","metadata":{}}')
  assert.equal(still.data, '/9j/4AAQ')
  assert.equal(stillAfter(still, '{"type":"frame","data":"<img>"}').data, '/9j/4AAQ')
  assert.equal(stillAfter(still, '').data, '/9j/4AAQ')
  assert.deepEqual(stillAfter(still, '{"type":"closed"}'), CLOSED)
})
