import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLOSED, FREE_POLICY, HELD_POLICY, isInputLine, stillOf } from '../src/browser.ts'

test('a still picture comes back with its page; a closed browser or junk reads as closed', () => {
  assert.deepEqual(stillOf('{"type":"still","url":"https://example.com/","title":"Example","data":"/9j/4AAQ"}\n'), { open: true, url: 'https://example.com/', title: 'Example', data: '/9j/4AAQ' })
  assert.deepEqual(stillOf('{"type":"closed"}\n'), CLOSED)
  assert.deepEqual(stillOf('Error: no such container\n'), CLOSED)
  assert.equal(stillOf('{"type":"still","url":"x","title":"y","data":"<script>"}').data, '')
})

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
