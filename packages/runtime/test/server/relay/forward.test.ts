import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { boxKey, identity, toBase64 } from '@openhut/common/vault/vault.ts'
import { serve, toHex } from '@openhut/tunnel'
import { startRelay, TOKEN, waitFor } from '@openhut/tunnel/test/relay.ts'

const relay = await startRelay()
const { config } = await import('../../../src/server/platform/config.ts')
config.relayUrl = relay.url
const { keyStore } = await import('../../../src/server/cloud/key-store.ts')
const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
const { db, migrate } = await import('../../../src/server/platform/db.ts')
const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
const { forward, forwardController } = await import('../../../src/server/relay/forward.ts')
const { relayIdOf } = await import('../../../src/server/relay/relay-service.ts')

await migrate()
const runner = await identity()
const runnerKey = await boxKey(runner.secret)
const RUNNER = toHex(runnerKey.publicKey)
const reached: string[] = []
const runnerServer = serve({
  relayUrl: relay.url, computerId: relayIdOf(runnerKey.publicKey), token: async () => TOKEN, key: runnerKey, listed: () => true,
  handle: async ({ method, path, body }) => {
    reached.push(`${method} ${path} ${await new Response(body).text()}`)
    return path === '/api/threads' ? Response.json({ id: 'th_onrunner' }) : Response.json({ on: 'runner', path }, { status: 201 })
  },
  socket: async ({ send }) => ({ send, close: () => undefined }),
})
await waitFor(relay.online)

const account = await keysService.open({ sub: 'google-mo', email: 'mo@example.com' })
const list = await keysService.addDevice({ device: toBase64(runner.publicKey), name: null })
if (list) await keyStore.write({ ...await keyStore.read(), account: { ...account, list } })
await keysService.setSession({ token: TOKEN, expiresAt: new Date(Date.now() + 3600_000).toISOString() })
await db.insertInto('person').values({ id: 'usr_fwdowner', email: 'mo', role: 'owner', removed_at: null }).onConflict((oc) => oc.doNothing()).execute()
await db.insertInto('agent').values([
  { id: 'ag_fwdthere', name: 'There', owner_id: 'usr_fwdowner', instructions: '# There', model: 'sonnet', net: 51, channel_key: 'k', runs_on: toBase64(runner.publicKey) },
  { id: 'ag_fwdhere', name: 'Here', owner_id: 'usr_fwdowner', instructions: '# Here', model: 'sonnet', net: 52, channel_key: 'k' },
]).execute()
await db.insertInto('thread').values([
  { id: 'th_fwdthere', agent_id: 'ag_fwdthere', person_id: 'usr_fwdowner', title: 'There' },
  { id: 'th_fwdhere', agent_id: 'ag_fwdhere', person_id: 'usr_fwdowner', title: 'Here' },
]).execute()

const app = Fastify()
answerErrors(app)
app.addHook('preHandler', forward.http)
app.get('/api/threads/:id', async () => ({ on: 'here' }))
app.post('/api/threads/:id/chat', async () => ({ on: 'here' }))
app.post('/api/threads', async () => ({ on: 'here' }))
await app.register(forwardController, { prefix: '/c' })
await app.ready()
const call = (method: 'GET' | 'POST', url: string, payload?: object) => app.inject({ method, url, payload, headers: { authorization: 'Bearer test-key' } })

test('a chat with an agent that runs on another of your computers goes over the tunnel and its answer comes back', async () => {
  const answer = await call('POST', '/api/threads/th_fwdthere/chat', { text: 'hi' })
  assert.deepEqual([answer.statusCode, answer.json()], [201, { on: 'runner', path: '/api/threads/th_fwdthere/chat' }])
  assert.deepEqual(reached, ['POST /api/threads/th_fwdthere/chat {"text":"hi"}'])
})

test('an agent that runs here is answered here', async () => {
  assert.deepEqual((await call('GET', '/api/threads/th_fwdhere')).json(), { on: 'here' })
  assert.deepEqual((await call('POST', '/api/threads', { agentId: 'ag_fwdhere' })).json(), { on: 'here' })
  assert.equal(reached.length, 1)
})

test('the runner\'s thread for an agent there is remembered, so its chat follows it', async () => {
  assert.deepEqual((await call('POST', '/api/threads', { agentId: 'ag_fwdthere' })).json(), { id: 'th_onrunner' })
  assert.equal((await call('GET', '/api/threads/th_onrunner')).statusCode, 201)
  assert.deepEqual(reached.slice(1), ['POST /api/threads {"agentId":"ag_fwdthere"}', 'GET /api/threads/th_onrunner '])
})

test('updating another computer goes to /api/updates there, and only for a computer of yours', async () => {
  assert.equal((await call('POST', `/c/${RUNNER}/api/updates`)).statusCode, 201)
  assert.equal(reached.at(-1), 'POST /api/updates ')
  assert.equal((await call('POST', `/c/${'ab'.repeat(32)}/api/updates`)).statusCode, 404)
})

test('a caller this runtime doesn\'t know is refused before anything is forwarded', async () => {
  const before = reached.length
  assert.equal((await app.inject({ method: 'POST', url: '/api/threads/th_fwdthere/chat', payload: {} })).statusCode, 401)
  assert.equal((await app.inject({ method: 'POST', url: `/c/${RUNNER}/api/updates` })).statusCode, 401)
  assert.equal(reached.length, before)
})

test('a runner that is off answers 502 with a sentence', async () => {
  runnerServer.close()
  await waitFor(() => !relay.online())
  const answer = await call('GET', '/api/threads/th_fwdthere')
  assert.equal(answer.statusCode, 502)
  assert.match(answer.json().error.message, /isn’t answering/)
})

test.after(async () => {
  await app.close()
  await relay.close()
})
