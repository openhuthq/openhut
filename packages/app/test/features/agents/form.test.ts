import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstModel, inUse } from '../../../src/features/agents/form.ts'

const provider = (id: string, connected: boolean, models: string[]) => ({ id, connected, models: models.map((model) => ({ id: model, on: true })) }) as never

test('the form picks Claude Sonnet first, then the first model on, and nothing when no provider is set up', () => {
  assert.equal(firstModel([provider('claude', true, ['opus', 'sonnet']), provider('openai', true, ['gpt'])]), 'claude:sonnet')
  assert.equal(firstModel([provider('claude', false, ['sonnet']), provider('openai', true, ['gpt'])]), 'openai:gpt')
  assert.equal(firstModel([provider('claude', false, ['sonnet'])]), null)
})

test('a provider just set up from the Model row becomes the pick', () => {
  assert.equal(firstModel([provider('claude', true, ['sonnet']), provider('openrouter', true, ['kimi'])], 'openrouter'), 'openrouter:kimi')
})

test('Models marks the one new agents use: Claude Sonnet first, else the first connected from top to bottom, none when nothing is set up', () => {
  assert.equal(inUse([provider('claude', true, ['sonnet']), provider('openrouter', true, ['x-ai/grok'])]), 'claude')
  assert.equal(inUse([provider('claude', false, ['sonnet']), provider('openrouter', true, ['x-ai/grok'])]), 'openrouter')
  assert.equal(inUse([provider('openai', false, ['gpt'])]), undefined)
  assert.equal(inUse(undefined), undefined)
})
