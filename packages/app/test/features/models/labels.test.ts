import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Provider, ProviderModel } from '@openhut/common/models/provider.ts'
import { consequence, context, count, plural, describe, foundNotice, glyphOf, matches, nameOf, prices, updatedAgo } from '../../../src/features/models/labels.ts'

const model = (id: string, patch: Partial<ProviderModel> = {}): ProviderModel => ({ id, name: id, on: true, tier: 'big', note: null, contextLength: null, inputPrice: null, outputPrice: null, ...patch })
const provider = (id: Provider['id'], models: ProviderModel[], kind: Provider['kind'] = 'key'): Provider => ({ id, object: 'provider', kind, name: id === 'openrouter' ? 'OpenRouter' : 'Claude subscription', connected: true, keyHint: null, updatedAt: null, models })

test('context windows read as K or M', () => {
  assert.deepEqual([context(200_000), context(1_000_000), context(256_000), context(1_048_576)], ['200K', '1M', '256K', '1M'])
})

test('a key model says its context and prices; a subscription model says its note', () => {
  const router = provider('openrouter', [])
  assert.equal(describe({ provider: router, model: model('x', { contextLength: 500_000, inputPrice: 15, outputPrice: 75 }) }), '500K context · $15 / $75 per 1M tokens')
  assert.equal(describe({ provider: router, model: model('x') }), '')
  assert.equal(describe({ provider: provider('claude', [], 'subscription'), model: model('opus', { note: 'Most capable' }) }), 'Most capable')
})

test('an unknown model is named by its id', () => {
  const providers = [provider('openrouter', [model('a/big')])]
  assert.equal(nameOf({ providers, key: 'xai:unknown' }), 'unknown')
})

test('search matches the name or the id, in any case', () => {
  assert.equal(matches({ model: model('anthropic/claude-opus', { name: 'Claude Opus' }), query: ' OPUS ' }), true)
  assert.equal(matches({ model: model('x', { name: 'Y' }), query: 'zzz' }), false)
  assert.equal(matches({ model: model('x'), query: '  ' }), true)
})

test('what the app says after connecting: models found and how many are on, or that a subscription signed in', () => {
  assert.equal(foundNotice({ provider: provider('openrouter', [model('a'), model('b', { on: false })]) }), 'Found 2 models. 1 is on. Turn on the ones your agents can use.')
  assert.equal(foundNotice({ provider: provider('openrouter', [model('a', { on: false })]) }), 'Found 1 model. None are on yet. Turn on the ones your agents can use.')
  assert.equal(foundNotice({ provider: provider('codex', [model('gpt-5.5')], 'subscription') }), 'Signed in. 1 model found.')
})

test('updated reads as just now, minutes, hours or days', () => {
  const ago = (seconds: number) => updatedAgo(new Date(Date.now() - seconds * 1000).toISOString())
  assert.deepEqual([updatedAgo(null), ago(5), ago(600), ago(7200), ago(172800)], ['', 'just now', '10 minutes ago', '2 hours ago', '2 days ago'])
})

test('counts carry thousands separators', () => {
  assert.deepEqual([count(1500), plural({ count: 1500, one: 'model', many: 'models' }), plural({ count: 1, one: 'model', many: 'models' })], ['1,500', '1,500 models', '1 model'])
})

test('disconnecting says who stops answering', () => {
  const agent = (name: string, model: string) => ({ name, model })
  const agents = [agent('Juniper', 'openrouter:a/b'), agent('Pepper', 'claude:opus'), agent('Maple', 'openrouter:x/y')]
  assert.equal(consequence({ agents, id: 'openrouter' }), 'Juniper and Maple use its models, and stop answering until you pick others.')
  assert.equal(consequence({ agents: [agent('Juniper', 'openrouter:a/b')], id: 'openrouter' }), 'Juniper uses its models, and stops answering until you pick others.')
  assert.equal(consequence({ agents, id: 'xai' }), 'No agent uses its models yet.')
})

test('prices keep two significant digits under a dollar and drop trailing zeros', () => {
  assert.equal(prices(model('x', { inputPrice: 0.036, outputPrice: 8.402 })), '$0.036 / $8.4')
  assert.equal(prices(model('x', { inputPrice: 2, outputPrice: 40 })), '$2 / $40')
  assert.equal(prices(model('x')), '')
})

test('a model shows its maker\'s logo, whichever provider runs it', () => {
  const ids = ['deepseek/deepseek-v4.1-flash', 'openai/gpt-6-luna', 'google/gemini-4-neon', 'x-ai/grok-4.7', 'anthropic/claude-opus-5.5', 'z-ai/glm-5.3-flash']
  assert.deepEqual(ids.map((model) => glyphOf({ provider: 'openrouter', model })), ['deepseek', 'openai', 'gemini', 'xai', 'anthropic', 'zai'])
  assert.equal(glyphOf({ provider: 'claude', model: 'opus' }), 'anthropic')
  assert.equal(glyphOf({ provider: 'codex', model: 'gpt-5.5' }), 'openai')
  assert.equal(glyphOf({ provider: 'xai', model: 'grok-4.7' }), 'xai')
  assert.equal(glyphOf({ provider: 'openrouter', model: 'someone/new-model' }), 'openrouter')
})
