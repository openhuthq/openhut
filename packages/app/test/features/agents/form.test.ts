import { test } from 'node:test'
import assert from 'node:assert/strict'
import { defaultComputer, firstModel, inUse, looksLikeEmail, searchPeople } from '../../../src/features/agents/form.ts'

const provider = (id: string, connected: boolean, models: string[]) => ({ id, connected, models: models.map((model) => ({ id: model, on: true })) }) as never

test('the form picks Claude Sonnet first, then the first model on, and nothing when no provider is set up', () => {
  assert.equal(firstModel([provider('claude', true, ['opus', 'sonnet']), provider('openai', true, ['gpt'])]), 'claude:sonnet')
  assert.equal(firstModel([provider('claude', false, ['sonnet']), provider('openai', true, ['gpt'])]), 'openai:gpt')
  assert.equal(firstModel([provider('claude', false, ['sonnet'])]), null)
})

test('a provider just set up from the Model row becomes the pick', () => {
  assert.equal(firstModel([provider('claude', true, ['sonnet']), provider('openrouter', true, ['kimi'])], 'openrouter'), 'openrouter:kimi')
})

test('Runs on starts on the online Linux server, else this computer', () => {
  const here = { id: 'local', kind: 'here', online: true } as const
  assert.equal(defaultComputer([here]), 'local')
  assert.equal(defaultComputer([here, { id: 'mac2', kind: 'desktop', online: true }]), 'local')
  assert.equal(defaultComputer([here, { id: 'box', kind: 'server', online: false }]), 'local')
  assert.equal(defaultComputer([here, { id: 'box', kind: 'server', online: true }]), 'box')
})

test('Models marks the one new agents use: Claude Sonnet first, else the first connected from top to bottom, none when nothing is set up', () => {
  assert.equal(inUse([provider('claude', true, ['sonnet']), provider('openrouter', true, ['x-ai/grok'])]), 'claude')
  assert.equal(inUse([provider('claude', false, ['sonnet']), provider('openrouter', true, ['x-ai/grok'])]), 'openrouter')
  assert.equal(inUse([provider('openai', false, ['gpt'])]), undefined)
  assert.equal(inUse(undefined), undefined)
})

test('Add people lists teammates other than the owner, picked or not, and says when a search finds no one', () => {
  const owner = 'mo@example.com'
  assert.deepEqual(searchPeople({ members: [owner], owner, query: '' }), { kind: 'found', emails: [] })
  assert.deepEqual(searchPeople({ members: [owner], owner, query: 'sara@example.com' }), { kind: 'none', query: 'sara@example.com' })
  assert.deepEqual(searchPeople({ members: [owner, 'sara@example.com'], owner, query: ' zzq ' }), { kind: 'none', query: 'zzq' })
  assert.deepEqual(searchPeople({ members: [owner, 'sara@example.com', 'ana@example.com'], owner, query: '' }), { kind: 'found', emails: ['sara@example.com', 'ana@example.com'] })
  assert.deepEqual(searchPeople({ members: [owner, 'sara@example.com', 'ana@example.com'], owner, query: 'SAR' }), { kind: 'found', emails: ['sara@example.com'] })
})

test('Share offers Invite only for a typed email', () => {
  assert.equal(looksLikeEmail('sara@example.com'), true)
  assert.equal(looksLikeEmail('sara'), false)
  assert.equal(looksLikeEmail('sara@example'), false)
})
