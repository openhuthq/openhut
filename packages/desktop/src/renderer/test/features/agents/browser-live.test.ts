import { test } from 'node:test'
import assert from 'node:assert/strict'
import { holdOf, keyInput, mouseInput, viewWidthOf } from '../../../src/features/agents/browser-live.ts'

test('a click becomes a press and a release at the same point', () => {
  assert.deepEqual(mouseInput({ action: 'down', x: 640, y: 210 }), { type: 'input_mouse', eventType: 'mousePressed', x: 640, y: 210, button: 'left', clickCount: 1, deltaX: 0, deltaY: 0, modifiers: 0 })
  assert.equal(mouseInput({ action: 'up', x: 640, y: 210 }).eventType, 'mouseReleased')
  assert.equal(mouseInput({ action: 'move', x: 1, y: 1 }).button, 'none')
})

test('letters type text; Enter and Backspace carry their key codes; Ctrl shortcuts type nothing', () => {
  assert.deepEqual(keyInput({ action: 'down', key: 'g', code: 'KeyG' }), { type: 'input_keyboard', eventType: 'keyDown', key: 'g', code: 'KeyG', text: 'g', windowsVirtualKeyCode: 71, modifiers: 0 })
  assert.equal(keyInput({ action: 'down', key: 'Enter' }).text, '\r')
  assert.equal(keyInput({ action: 'down', key: 'Enter' }).windowsVirtualKeyCode, 13)
  assert.equal(keyInput({ action: 'down', key: 'Backspace' }).windowsVirtualKeyCode, 8)
  assert.equal(keyInput({ action: 'down', key: 'Backspace' }).text, undefined)
  assert.equal(keyInput({ action: 'down', key: 'a', modifiers: 2 }).text, undefined)
  assert.equal(keyInput({ action: 'up', key: 'a' }).text, undefined)
})

test('the hold is this window\'s when the runtime says so, and an older runtime without mine means the window that asked', () => {
  assert.deepEqual(holdOf({ type: 'hold', held: true, mine: true }), { held: true, mine: true })
  assert.deepEqual(holdOf({ type: 'hold', held: true, mine: false }), { held: true, mine: false })
  assert.deepEqual(holdOf({ type: 'hold', held: true }), { held: true, mine: true })
  assert.deepEqual(holdOf({ type: 'hold', held: false }), { held: false, mine: false })
})

test('a click maps to the page viewport, not the scaled-down frame', () => {
  assert.equal(viewWidthOf({ deviceWidth: 1280, deviceHeight: 720 }), 1280)
  assert.equal(viewWidthOf({}), undefined)
  assert.equal(viewWidthOf(undefined), undefined)
})
