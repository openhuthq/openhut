import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSlots } from '../../../src/server/models/model-slots.ts'

const model = (id: string, tier: 'big' | 'fast', on = true, contextLength: number | null = null) => ({ id, name: id, on, tier, note: null, contextLength, inputPrice: null, outputPrice: null })
const catalog = (provider: string) => provider === 'openai' ? [model('gpt-5.5', 'big', true, 400000), model('gpt-5.5-mini', 'fast', false), model('gpt-5.5-nano', 'fast')] : [model('opus', 'big'), model('haiku', 'fast')]
const resolve = ({ model }: { model: string }) => resolveSlots({ model, catalog })

test('the main model carries its context length', () => {
  assert.deepEqual(resolve({ model: 'openai:gpt-5.5' }).primary, { provider: 'openai', model: 'gpt-5.5', contextLength: 400000 })
})

test('ids from before model keys still mean what they did, and a broken key falls back to Sonnet instead of failing the render', () => {
  assert.equal(resolve({ model: 'haiku' }).primary.model, 'haiku')
  assert.equal(resolve({ model: 'codex' }).primary.provider, 'codex')
  assert.deepEqual(resolve({ model: 'nonsense' }).primary, { provider: 'claude', model: 'sonnet', contextLength: null })
})
