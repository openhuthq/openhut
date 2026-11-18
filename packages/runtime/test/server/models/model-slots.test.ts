import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveSlots } from '../../../src/server/models/model-slots.ts'

const model = (id: string, tier: 'big' | 'fast', on = true, contextLength: number | null = null) => ({ id, name: id, on, tier, note: null, contextLength, inputPrice: null, outputPrice: null })
const catalog = (provider: string) => provider === 'openai' ? [model('gpt-5.5', 'big', true, 400000), model('gpt-5.5-mini', 'fast', false), model('gpt-5.5-nano', 'fast')] : [model('opus', 'big'), model('haiku', 'fast')]
const resolve = (choice: { model: string; helpers?: { compress?: string | null } }) => resolveSlots({ model: choice.model, helpers: choice.helpers ?? {}, catalog })

test('Automatic is the first switched-on fast model of the main model\'s provider, and the main model itself when there is none', () => {
  assert.deepEqual(resolve({ model: 'openai:gpt-5.5' }).helpers.title, { provider: 'openai', model: 'gpt-5.5-nano', contextLength: null })
  assert.deepEqual(resolve({ model: 'claude:opus' }).helpers.compress, { provider: 'claude', model: 'haiku', contextLength: null })
  const only = resolveSlots({ model: 'xai:grok-5', helpers: {}, catalog: () => [] })
  assert.deepEqual(only.helpers.review, only.primary)
})

test('a picked helper wins, and the main model carries its context length', () => {
  const slots = resolve({ model: 'openai:gpt-5.5', helpers: { compress: 'claude:opus' } })
  assert.equal(slots.helpers.compress.model, 'opus')
  assert.equal(slots.helpers.title.model, 'gpt-5.5-nano')
  assert.equal(slots.primary.contextLength, 400000)
})

test('ids from before model keys still mean what they did, and a broken key falls back to Sonnet instead of failing the render', () => {
  assert.equal(resolve({ model: 'haiku' }).primary.model, 'haiku')
  assert.equal(resolve({ model: 'codex' }).primary.provider, 'codex')
  assert.deepEqual(resolve({ model: 'nonsense' }).primary, { provider: 'claude', model: 'sonnet', contextLength: null })
})
