import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessLabel, defaultComputer, firstModel, inUse, looksLikeEmail, ONLY_YOU, previewOf, searchPeople, withWholeTeam } from '../../../src/features/agents/form.ts'

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

test('the Access row shows exactly who is picked: your face alone, names up to three, then faces and +N', () => {
  const owner = 'mo@example.com'
  assert.deepEqual(previewOf({ owner, people: [] }), { faces: [owner], text: 'Only you', label: 'Only you' })
  assert.deepEqual(previewOf({ owner, people: ['sara@example.com'] }), { faces: [owner, 'sara@example.com'], text: 'You and Sara', label: 'You and Sara' })
  assert.deepEqual(previewOf({ owner, people: ['sara@example.com', 'ana@example.com'] }), { faces: [owner, 'sara@example.com', 'ana@example.com'], text: 'You, Sara and Ana', label: 'You, Sara and Ana' })
  assert.deepEqual(previewOf({ owner, people: ['sara@example.com', 'ana@example.com', 'li@example.com', 'jo@example.com'] }), { faces: [owner, 'sara@example.com', 'ana@example.com'], text: '+2', label: 'You and 4 more' })
})

test('a new agent opens to only you until you add someone', () => {
  assert.equal(ONLY_YOU.shared, false)
  assert.equal(accessLabel({ value: ONLY_YOU, owner: 'owner@example.com', team: 'Acme' }), 'Only you')
})

test('Whole team gives everyone on the team access and keeps the people picked', () => {
  const on = withWholeTeam({ shared: false, people: ['pat@example.com'], sidebars: ['pat@example.com'] }, true)
  assert.deepEqual(on, { shared: true, people: ['pat@example.com'], sidebars: [] })
  assert.equal(accessLabel({ value: on, owner: 'owner@example.com', team: 'Acme' }), 'Everyone on Acme')
})
