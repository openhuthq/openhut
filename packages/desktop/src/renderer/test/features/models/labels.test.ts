import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Provider, ProviderModel } from '@openhut/common/models/provider.ts'
import { automatic, consequence, context, count, plural, describe, foundNotice, matches, nameOf, updatedAgo } from '../../../src/features/models/labels.ts'

const model = (id: string, patch: Partial<ProviderModel> = {}): ProviderModel => ({ id, name: id, on: true, tier: 'big', note: null, contextLength: null, inputPrice: null, outputPrice: null, ...patch })
const provider = (id: Provider['id'], models: ProviderModel[], kind: Provider['kind'] = 'key'): Provider => ({ id, object: 'provider', kind, name: id === 'openrouter' ? 'OpenRouter' : 'Claude subscription', connected: true, keyHint: null, updatedAt: null, models })

test('context windows read as K or M', () => {
  assert.deepEqual([context(200_000), context(1_000_000), context(256_000)], ['200K', '1M', '256K'])
})

test('a key model says its provider, context and prices; a subscription model says the plan and its note', () => {
  const router = provider('openrouter', [])
  assert.equal(describe({ provider: router, model: model('x', { contextLength: 500_000, inputPrice: 15, outputPrice: 75 }) }), 'OpenRouter · 500K context · $15 / $75 per M')
  assert.equal(describe({ provider: router, model: model('x') }), 'OpenRouter')
  assert.equal(describe({ provider: provider('claude', [], 'subscription'), model: model('opus', { note: 'Most capable' }) }), 'Claude subscription · Most capable')
})

test('Automatic is the first switched-on fast model of the same provider, else the main model', () => {
  const providers = [provider('openrouter', [model('a/big'), model('b/off-mini', { tier: 'fast', on: false }), model('c/flash', { tier: 'fast', name: 'Flash' })])]
  assert.deepEqual(automatic({ providers, key: 'openrouter:a/big' }), { key: 'openrouter:c/flash', name: 'Flash', same: false })
  assert.deepEqual(automatic({ providers: [provider('openrouter', [model('a/big')])], key: 'openrouter:a/big' }), { key: 'openrouter:a/big', name: 'a/big', same: true })
  assert.equal(nameOf({ providers, key: 'xai:unknown' }), 'unknown')
})

test('search matches the name or the id, in any case', () => {
  assert.equal(matches({ model: model('anthropic/claude-opus', { name: 'Claude Opus' }), query: ' OPUS ' }), true)
  assert.equal(matches({ model: model('x', { name: 'Y' }), query: 'zzz' }), false)
  assert.equal(matches({ model: model('x'), query: '  ' }), true)
})

test('what the app says after connecting: models found and how many are on, or that a subscription signed in', () => {
  assert.equal(foundNotice({ provider: provider('openrouter', [model('a'), model('b', { on: false })]) }), 'Found 2 models. 1 is switched on, turn on the ones agents may use.')
  assert.equal(foundNotice({ provider: provider('openrouter', [model('a', { on: false })]) }), 'Found 1 model. None are switched on yet, turn on the ones agents may use.')
  assert.equal(foundNotice({ provider: provider('codex', [model('gpt-5.5')], 'subscription') }), 'Signed in. 1 model found.')
})

test('updated reads as just now, minutes, hours or days', () => {
  const ago = (seconds: number) => updatedAgo(new Date(Date.now() - seconds * 1000).toISOString())
  assert.deepEqual([updatedAgo(null), ago(5), ago(600), ago(7200), ago(172800)], ['', 'just now', '10 minutes ago', '2 hours ago', '2 days ago'])
})

test('counts carry thousands separators', () => {
  assert.deepEqual([count(1500), plural({ count: 1500, one: 'model', many: 'models' }), plural({ count: 1, one: 'model', many: 'models' })], ['1,500', '1,500 models', '1 model'])
})

test('disconnecting says who stops answering and who only loses a fallback or a helper', () => {
  const agent = (name: string, model: string, fallbackModel: string | null = null, review: string | null = null) => ({ name, model, fallbackModel, helperModels: { compress: null, title: null, review } })
  const agents = [agent('Juniper', 'openrouter:a/b'), agent('Ops', 'claude:haiku', 'openrouter:a/b'), agent('Scout', 'claude:opus', null, 'openrouter:c/d'), agent('Pepper', 'claude:opus'), agent('Maple', 'openrouter:x/y', 'openrouter:a/b')]
  assert.equal(consequence({ agents, id: 'openrouter' }), 'Juniper and Maple use its models, and stop answering until you pick others. Ops and Scout use it as a fallback or helper model, and that part stops working until you pick another.')
  assert.equal(consequence({ agents: [agent('Ops', 'claude:haiku', 'openrouter:a/b')], id: 'openrouter' }), 'Ops uses it as a fallback or helper model, and that part stops working until you pick another.')
  assert.equal(consequence({ agents: [agent('Juniper', 'openrouter:a/b')], id: 'openrouter' }), 'Juniper uses its models, and stops answering until you pick others.')
  assert.equal(consequence({ agents, id: 'xai' }), 'No agent uses its models yet.')
})
