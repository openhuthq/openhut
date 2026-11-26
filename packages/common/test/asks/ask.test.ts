import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isStarter, starterInstructions } from '../../src/asks/ask.ts'

test('only an agent with its starter instructions is new', () => {
  assert.equal(isStarter({ name: 'Pulse', instructions: starterInstructions('Pulse') }), true)
  assert.equal(isStarter({ name: 'Pulse', instructions: '# Pulse\n\nKeep prod-db healthy.' }), false)
})
