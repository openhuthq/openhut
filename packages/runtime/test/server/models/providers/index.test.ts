import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tierOf } from '../../../../src/server/models/providers/index.ts'

test('a fast model is named mini, nano, flash, haiku, lite, small or fast as a word, so Gemini is not fast', () => {
  const fast = ['gpt-5.5-mini', 'google/gemini-3.8-flash', 'anthropic/claude-haiku-5.5', 'x-ai/grok-5-fast', 'gemini-flash-lite', 'gpt-5.4-nano']
  const big = ['google/gemini-4-carbon', 'anthropic/claude-fable-5.2', 'openai/gpt-6.2-astra-pro', 'qwen/qwen4-max']
  assert.deepEqual(fast.map(tierOf), fast.map(() => 'fast'))
  assert.deepEqual(big.map(tierOf), big.map(() => 'big'))
})
