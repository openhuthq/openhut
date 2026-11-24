import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstModel, noteOf } from '../../../src/features/agents/form.ts'

const provider = (id: string, connected: boolean, models: string[]) => ({ id, connected, models: models.map((model) => ({ id: model, on: true })) }) as never

test('the form picks Claude Sonnet first, then the first model on, and nothing when no provider is set up', () => {
  assert.equal(firstModel([provider('claude', true, ['opus', 'sonnet']), provider('openai', true, ['gpt'])]), 'claude:sonnet')
  assert.equal(firstModel([provider('claude', false, ['sonnet']), provider('openai', true, ['gpt'])]), 'openai:gpt')
  assert.equal(firstModel([provider('claude', false, ['sonnet'])]), null)
})

test('a provider just set up from the Model row becomes the pick', () => {
  assert.equal(firstModel([provider('claude', true, ['sonnet']), provider('openrouter', true, ['kimi'])], 'openrouter'), 'openrouter:kimi')
})

test('the one-line note follows the pick, and offers a Linux server only when the team has none', () => {
  assert.match(noteOf({ where: { kind: 'server', server: false }, computers: [], here: 'Mac' }), /own box/)
  assert.match(noteOf({ where: { kind: 'here', server: false } as never, computers: [{ kind: 'server' }], here: 'Mac' }), /Pick your Linux server/)
  assert.match(noteOf({ where: { kind: 'here', server: false } as never, computers: [{ kind: 'here' } as never], here: 'Mac' }), /Add a Linux server/)
})
