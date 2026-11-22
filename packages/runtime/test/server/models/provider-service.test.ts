import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'

const hits: string[] = []
let openaiModels: { id: string; created: number }[] = []
const fake = createServer((req, res) => {
  hits.push(`${req.method} ${req.url}`)
  const ok = req.headers.authorization === 'Bearer sk-good-key-1234'
  const reply = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
  if (req.url === '/openrouter/api/v1/key') return reply(ok ? 200 : 401, ok ? { data: {} } : { error: { message: 'no' } })
  if (req.url === '/openrouter/api/v1/models') {
    return reply(200, { data: [
      { id: 'anthropic/claude-opus-5.5', name: 'Anthropic: Claude Opus 5.5', created: 30, context_length: 500000, pricing: { prompt: '0.000015', completion: '0.000075' }, architecture: { output_modalities: ['text'] } },
      { id: 'anthropic/claude-sonnet-5.5', name: 'Anthropic: Claude Sonnet 5.5', created: 10, context_length: 1000000, pricing: { prompt: '0.0000001', completion: '0.0000005' } },
      { id: 'black-forest/flux', name: 'Flux', created: 31, architecture: { output_modalities: ['image'] } },
      { id: 'openrouter/auto', name: 'Auto', created: 20, context_length: 2000000, pricing: { prompt: '-1', completion: '-1' } },
    ] })
  }
  if (req.url === '/openai/v1/models') return ok ? reply(200, { data: openaiModels }) : reply(401, { error: { message: 'bad' } })
  if (req.url === '/xai/v1/models') return reply(503, {})
  reply(404, {})
})
fake.listen(0, '127.0.0.1')
await once(fake, 'listening')
const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`
const { config } = await import('../../../src/server/platform/config.ts')
Object.assign(config, { openaiApi: `${base}/openai`, openrouterApi: `${base}/openrouter/api`, xaiApi: `${base}/xai` })
after(() => fake.close())

const { migrate } = await import('../../../src/server/platform/db.ts')
const { settings } = await import('../../../src/server/platform/settings.ts')
const { providerService } = await import('../../../src/server/models/provider-service.ts')
await migrate()

const actor = { id: 'usr_provider1', email: 'owner@example.com', local: false }
const GOOD = 'sk-good-key-1234'
const many = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `gpt-${index}`, created: index }))

test('a good key connects, lists only chat models, switches on the eight newest and is never sent back', async () => {
  openaiModels = [...many(12), { id: 'dall-e-3', created: 99 }, { id: 'text-embedding-3-small', created: 98 }, { id: 'whisper-1', created: 97 }]
  const provider = await providerService.update({ actor, id: 'openai', patch: { apiKey: GOOD } })
  assert.equal(provider.connected, true)
  assert.equal(provider.keyHint, 'sk-go…1234')
  assert.equal(provider.models.length, 12)
  assert.deepEqual(provider.models.filter((model) => model.on).map((model) => model.id).sort(), ['gpt-10', 'gpt-11', 'gpt-4', 'gpt-5', 'gpt-6', 'gpt-7', 'gpt-8', 'gpt-9'])
  assert.equal(JSON.stringify(provider).includes(GOOD), false)
  assert.equal(settings.providerKey('openai'), GOOD)
})

test('a refused key is a 400 on apiKey and saves nothing', async () => {
  await assert.rejects(providerService.update({ actor, id: 'xai', patch: { apiKey: 'sk-bad-key-12345' } }), /xAI answered 503/)
  await assert.rejects(providerService.update({ actor, id: 'openrouter', patch: { apiKey: 'sk-bad-key-12345' } }), (err: unknown) => err instanceof Error && /OpenRouter refused that key/.test(err.message) && 'param' in err && err.param === 'apiKey')
  assert.equal(providerService.get({ id: 'openrouter' }).connected, false)
  assert.equal(settings.providerKey('openrouter'), '')
  assert.equal(providerService.get({ id: 'xai' }).connected, false)
})

test('OpenRouter: the key is checked first, image models are left out, names lose the lab prefix, prices are dollars per million tokens and only the hand-picked models start on', async () => {
  hits.length = 0
  const provider = await providerService.update({ actor, id: 'openrouter', patch: { apiKey: GOOD } })
  assert.deepEqual(hits, ['GET /openrouter/api/v1/key', 'GET /openrouter/api/v1/models'])
  const opus = provider.models.find((model) => model.id === 'anthropic/claude-opus-5.5')
  assert.deepEqual([opus?.name, opus?.contextLength, opus?.inputPrice, opus?.outputPrice, opus?.tier], ['Claude Opus 5.5', 500000, 15, 75, 'big'])
  assert.equal(provider.models.some((model) => model.id === 'black-forest/flux'), false)
  assert.equal(provider.models.find((model) => model.id === 'openrouter/auto')?.inputPrice, null)
  assert.deepEqual(provider.models.filter((model) => model.on).map((model) => model.id), ['anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5'])
})

test('switching models keeps to the list, and only a connected provider can be switched', async () => {
  const off = await providerService.update({ actor, id: 'openai', patch: { models: [{ id: 'gpt-11', on: false }, { id: 'gpt-0', on: true }] } })
  assert.deepEqual([off.models.find((model) => model.id === 'gpt-11')?.on, off.models.find((model) => model.id === 'gpt-0')?.on], [false, true])
  await assert.rejects(providerService.update({ actor, id: 'openai', patch: { models: [{ id: 'gpt-404', on: true }] } }), /isn't in the list/)
  await assert.rejects(providerService.update({ actor, id: 'xai', patch: { models: [{ id: 'grok', on: true }] } }), /isn't connected/)
})

test('a refresh keeps the switches, adds new models switched off and drops the ones that are gone', async () => {
  openaiModels = [...many(11), { id: 'gpt-new', created: 100 }]
  const refreshed = await providerService.refresh({ id: 'openai' })
  assert.deepEqual(refreshed.models.map((model) => model.id).sort(), [...many(11).map((model) => model.id), 'gpt-new'].sort())
  assert.equal(refreshed.models.find((model) => model.id === 'gpt-new')?.on, false)
  assert.equal(refreshed.models.find((model) => model.id === 'gpt-0')?.on, true)
  assert.equal(refreshed.models.find((model) => model.id === 'gpt-11'), undefined)
})

test('an agent may be given only a model that is connected, listed and switched on', () => {
  providerService.requireUsable({ key: 'openai:gpt-0', param: 'model' })
  assert.throws(() => providerService.requireUsable({ key: 'openai:gpt-3', param: 'model' }), /switched off/)
  assert.throws(() => providerService.requireUsable({ key: 'openai:nope', param: 'model' }), /doesn't list nope/)
  assert.throws(() => providerService.requireUsable({ key: 'xai:grok-5', param: 'model' }), /isn't connected on this computer/)
  assert.throws(() => providerService.requireUsable({ key: 'nonsense', param: 'model' }), /provider:model/)
})

test('Claude and Codex are not keys; Codex is connected by signing in, and disconnecting forgets its tokens and its list', async () => {
  await assert.rejects(providerService.update({ actor, id: 'claude', patch: { apiKey: GOOD } }), /signs in with an account/)
  await settings.setCodexTokens({ accessToken: 'a', refreshToken: 'r' })
  assert.equal(providerService.get({ id: 'codex' }).connected, true)
  assert.deepEqual(providerService.get({ id: 'codex' }).models.map((model) => [model.id, model.on]), [['gpt-5.5', true]])
  const gone = await providerService.disconnect({ actor, id: 'codex' })
  assert.deepEqual([gone.connected, gone.models, settings.codexTokens()], [false, [], undefined])
})

test('disconnecting a key forgets it', async () => {
  const gone = await providerService.disconnect({ actor, id: 'openai' })
  assert.deepEqual([gone.connected, gone.keyHint, gone.models, settings.providerKey('openai')], [false, null, [], ''])
})
