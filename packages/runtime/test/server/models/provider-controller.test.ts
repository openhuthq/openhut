import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { migrate } from '../../../src/server/platform/db.ts'
import { validateWithZod } from '../../../src/server/platform/validation.ts'
import { providerController } from '../../../src/server/models/provider-controller.ts'
import { config } from '../../../src/server/platform/config.ts'

await migrate()

async function app() {
  const server = Fastify()
  answerErrors(server)
  server.setValidatorCompiler(validateWithZod)
  await server.register(providerController, { prefix: '/api/providers' })
  return server
}

const auth = { authorization: 'Bearer test-key' }

test('providers are a Stripe-shaped list, Claude counts as connected in test mode, and the others offer no models until connected', async () => {
  const server = await app()
  const res = await server.inject({ method: 'GET', url: '/api/providers', headers: auth })
  assert.equal(res.statusCode, 200)
  const list = res.json()
  assert.deepEqual([list.object, list.url, list.hasMore], ['list', '/api/providers', false])
  assert.deepEqual(list.data.map((each: { id: string }) => each.id), ['openhut', 'claude', 'codex', 'openrouter', 'openai', 'xai'])
  const [openhut, claude, codex, openrouter] = list.data
  assert.deepEqual([claude.object, claude.connected, claude.models.map((model: { id: string }) => model.id), config.modelMode], ['provider', true, ['opus', 'sonnet', 'haiku'], 'test'])
  assert.deepEqual([openhut.connected, codex.connected, codex.models, openrouter.connected, openrouter.keyHint], [false, false, [], false, null])
})

test('a bad id, a short key and an empty body are 400s that name the field; no key means 401', async () => {
  const server = await app()
  assert.equal((await server.inject({ method: 'GET', url: '/api/providers/nowhere', headers: auth })).statusCode, 400)
  const short = await server.inject({ method: 'PATCH', url: '/api/providers/openai', headers: auth, payload: { apiKey: 'abc' } })
  assert.equal(short.statusCode, 400)
  assert.equal(short.json().error.param, 'apiKey')
  assert.match(short.json().error.message, /That does not look like a key\. Paste the whole thing\.$/)
  const huge = await server.inject({ method: 'PATCH', url: '/api/providers/openai', headers: auth, payload: { apiKey: 'k'.repeat(100_000) } })
  assert.deepEqual([huge.statusCode, huge.json().error.param], [400, 'apiKey'])
  assert.equal((await server.inject({ method: 'PATCH', url: '/api/providers/openai', headers: auth, payload: {} })).statusCode, 400)
  assert.equal((await server.inject({ method: 'GET', url: '/api/providers' })).statusCode, 401)
})
