import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BrowserInput } from '@openhut/common/agents/browser.ts'
import { inputLine } from '../../../src/server/agents/browser-service.ts'

test('a click becomes a press and a release at the same point', () => {
  assert.deepEqual(JSON.parse(inputLine({ type: 'mouse', action: 'down', x: 640, y: 210 })), { type: 'input_mouse', eventType: 'mousePressed', x: 640, y: 210, button: 'left', clickCount: 1, deltaX: 0, deltaY: 0, modifiers: 0 })
  assert.equal(JSON.parse(inputLine({ type: 'mouse', action: 'up', x: 640, y: 210 })).eventType, 'mouseReleased')
  assert.equal(JSON.parse(inputLine({ type: 'mouse', action: 'move', x: 1, y: 1 })).button, 'none')
})

test('letters type text; Enter and Backspace carry their key codes; Ctrl shortcuts type nothing', () => {
  assert.deepEqual(JSON.parse(inputLine({ type: 'key', action: 'down', key: 'g', code: 'KeyG' })), { type: 'input_keyboard', eventType: 'keyDown', key: 'g', code: 'KeyG', text: 'g', windowsVirtualKeyCode: 71, modifiers: 0 })
  assert.equal(JSON.parse(inputLine({ type: 'key', action: 'down', key: 'Enter' })).text, '\r')
  assert.equal(JSON.parse(inputLine({ type: 'key', action: 'down', key: 'Enter' })).windowsVirtualKeyCode, 13)
  const backspace = JSON.parse(inputLine({ type: 'key', action: 'down', key: 'Backspace' }))
  assert.equal(backspace.windowsVirtualKeyCode, 8)
  assert.equal(backspace.text, undefined)
  assert.equal(JSON.parse(inputLine({ type: 'key', action: 'down', key: 'a', modifiers: 2 })).text, undefined)
  assert.equal(JSON.parse(inputLine({ type: 'key', action: 'up', key: 'a' })).text, undefined)
})

test('input from the viewer is bounded: no commands, no huge batches, no off-screen coordinates', () => {
  assert.equal(BrowserInput.safeParse({ events: [{ type: 'mouse', action: 'down', x: 1, y: 2 }] }).success, true)
  assert.equal(BrowserInput.safeParse({ events: [{ type: 'command', action: 'navigate', url: 'http://10.0.0.1/' }] }).success, false)
  assert.equal(BrowserInput.safeParse({ events: [] }).success, false)
  assert.equal(BrowserInput.safeParse({ events: Array(65).fill({ type: 'key', action: 'down', key: 'a' }) }).success, false)
  assert.equal(BrowserInput.safeParse({ events: [{ type: 'mouse', action: 'down', x: -5, y: 2 }] }).success, false)
})
