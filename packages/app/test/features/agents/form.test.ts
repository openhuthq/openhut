import { test } from 'node:test'
import assert from 'node:assert/strict'
import { firstModel, inUse, noteOf, searchPeople } from '../../../src/features/agents/form.ts'

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

test('Models marks the one new agents use: Claude Sonnet first, else the first connected from top to bottom, none when nothing is set up', () => {
  assert.equal(inUse([provider('claude', true, ['sonnet']), provider('openrouter', true, ['x-ai/grok'])]), 'claude')
  assert.equal(inUse([provider('claude', false, ['sonnet']), provider('openrouter', true, ['x-ai/grok'])]), 'openrouter')
  assert.equal(inUse([provider('openai', false, ['gpt'])]), undefined)
  assert.equal(inUse(undefined), undefined)
})

test('the Share field: a team of one says so, a search with no match says so, and people already added are not offered again', () => {
  const owner = 'mo@example.com'
  assert.deepEqual(searchPeople({ members: [owner], owner, added: [], query: '' }), { kind: 'alone' })
  assert.deepEqual(searchPeople({ members: [owner, 'sara@example.com'], owner, added: [], query: ' zzq ' }), { kind: 'none', query: 'zzq' })
  assert.deepEqual(searchPeople({ members: [owner, 'sara@example.com', 'ana@example.com'], owner, added: ['ana@example.com'], query: '' }), { kind: 'found', emails: ['sara@example.com'] })
  assert.deepEqual(searchPeople({ members: [owner, 'sara@example.com', 'ana@example.com'], owner, added: [], query: 'SAR' }), { kind: 'found', emails: ['sara@example.com'] })
})
