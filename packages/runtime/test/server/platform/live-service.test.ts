import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { emit, listen } from '../../../src/server/platform/events.ts'
import { eventsController } from '../../../src/server/platform/events-controller.ts'
import { validatorCompiler } from 'fastify-type-provider-zod'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { LiveDown } from '@openhut/common/live.ts'
import { config } from '../../../src/server/platform/config.ts'
import { seal, sha } from '../../../src/server/platform/secrets.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { threadController } from '../../../src/server/threads/thread-controller.ts'
import { HERE } from '../../../src/server/team/home.ts'
import { useFakeRecords } from '../agents/records-fake.ts'

const KEY = { authorization: 'Bearer test-key' }

await migrate()
useFakeRecords({ by: HERE })
await db.insertInto('person').values([
  { id: 'usr_liveown', email: 'owner@example.com', name: 'Owner', role: 'owner', removed_at: null },
  { id: 'usr_livemia', email: 'mia@example.com', name: 'Mia', role: 'member', removed_at: null },
  { id: 'usr_livezed', email: 'zed@example.com', name: 'Zed', role: 'member', removed_at: null },
]).execute()
await db.insertInto('session').values([
  { hash: sha('ohs_livemia'), person_id: 'usr_livemia', expires_at: new Date(Date.now() + 600_000) },
  { hash: sha('ohs_livezed'), person_id: 'usr_livezed', expires_at: new Date(Date.now() + 600_000) },
]).execute()
await db.insertInto('agent').values({ id: 'ag_liveteam', name: 'Teamer', owner: 'owner@example.com', owner_id: 'usr_liveown', people: '["mia@example.com"]', instructions: '# Teamer', model: 'sonnet', net: 31, channel_key: seal('k'.repeat(48)), wanted: 'running' }).execute()
const MIA = { cookie: 'openhut_session=ohs_livemia' }
const ZED = { cookie: 'openhut_session=ohs_livezed' }

let release = () => {}
const hermes = createServer((req, res) => {
  req.resume()
  req.on('end', async () => {
    const chunk = (content: string) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(chunk('Hello '))
    res.write(chunk('there.'))
    await new Promise<void>((resolve) => { release = resolve })
    res.write(`event: hermes.tool.progress\ndata: ${JSON.stringify({ tool: 'web_search', label: 'news', toolCallId: 'w', status: 'running' })}\n\n`)
    res.end(`${chunk('Done.')}data: [DONE]\n\n`)
  })
})
await new Promise<void>((resolve) => hermes.listen(0, '127.0.0.1', resolve))
config.agentApi = `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`

const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validatorCompiler)
await app.register(websocket)
await app.register(eventsController, { prefix: '/api/events' })
await app.register(threadController, { prefix: '/api/threads' })
await app.ready()
test.after(() => { hermes.close(); return app.close() })

test('the event stream is refused without the key and from another site', async () => {
  assert.equal((await closed(await app.injectWS('/api/events'))).code, 4401)
  assert.equal((await closed(await app.injectWS('/api/events', { headers: { ...KEY, origin: 'https://evil.example' } }))).code, 4403)
})

test('a follower hears hello, then only what changed: the object and its id, never the details', async () => {
  const lines: { type: string }[] = []
  const ws = await app.injectWS('/api/events', { headers: KEY }, { onInit: (socket) => socket.on('message', (data) => lines.push(JSON.parse(String(data)))) })
  await until(() => lines.length === 1)
  assert.deepEqual(lines[0], { object: 'event', type: 'hello', data: { object: 'computer', id: 'this' } })
  emit({ name: 'invitation.created', target: { type: 'invitation', id: 'inv_1' } })
  emit({ name: 'thread.updated', target: { type: 'thread', id: 'th_1', text: 'a secret message' }, properties: { words: 'private' } })
  await until(() => lines.length === 2)
  assert.deepEqual(lines[1], { object: 'event', type: 'thread.updated', data: { object: 'thread', id: 'th_1' } })
  ws.terminate()
})

test('a listener that throws doesn\'t stop the others or fail the write that emitted', async () => {
  listen(() => { throw new Error('broken listener') })
  const lines: { type: string }[] = []
  const ws = await app.injectWS('/api/events', { headers: KEY }, { onInit: (socket) => socket.on('message', (data) => lines.push(JSON.parse(String(data)))) })
  await until(() => lines.length === 1)
  assert.doesNotThrow(() => emit({ name: 'agent.updated', target: { type: 'agent', id: 'ag_1' } }))
  await until(() => lines.length === 2)
  assert.equal(lines[1].type, 'agent.updated')
  ws.terminate()
})

test('everyone viewing a thread sees who is there and typing, and the same reply text as it streams; others can\'t join', async () => {
  const owner = await follower(KEY)
  const mia = await follower(MIA)
  const zed = await follower(ZED)
  owner.send({ type: 'join', thread: 'ag_liveteam' })
  await until(() => owner.last('presence')?.people.length === 1)
  mia.send({ type: 'join', thread: 'ag_liveteam' })
  await until(() => owner.last('presence')?.people.length === 2)
  assert.deepEqual(owner.last('presence'), { type: 'presence', thread: 'ag_liveteam', people: [
    { id: 'usr_liveown', name: 'Owner', email: 'owner@example.com', state: 'viewing' },
    { id: 'usr_livemia', name: 'Mia', email: 'mia@example.com', state: 'viewing' },
  ], agent: { state: 'idle' } })
  mia.send({ type: 'typing', thread: 'ag_liveteam', on: true })
  await until(() => owner.last('presence')?.people[1].state === 'typing')
  mia.send({ type: 'typing', thread: 'ag_liveteam', on: false })
  await until(() => owner.last('presence')?.people[1].state === 'viewing')

  zed.send({ type: 'join', thread: 'ag_liveteam' })
  await until(() => zed.heard.some((each) => each.type === 'error'))
  assert.deepEqual(zed.heard.find((each) => each.type === 'error'), { type: 'error', thread: 'ag_liveteam', message: 'That chat doesn\'t exist, or you can\'t see it.' })
  assert.equal((await app.inject({ method: 'GET', url: '/api/threads/ag_liveteam/live', headers: ZED })).statusCode, 404)

  const sent = app.inject({ method: 'POST', url: '/api/threads/ag_liveteam/chat', headers: KEY, payload: { trigger: 'submit-message', message: { id: 'm1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] } } })
  await until(() => mia.delta() === 'Hello there.')
  const caught = (await app.inject({ method: 'GET', url: '/api/threads/ag_liveteam/live', headers: MIA })).json()
  assert.equal(caught.text, 'Hello there.')
  assert.equal(caught.agent.state, 'replying')
  assert.deepEqual(caught.agent.answering, ['owner@example.com'])
  release()
  const res = await sent
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /Done\./)
  await until(() => mia.last('turn')?.state === 'done')
  assert.equal(mia.delta(), 'Hello there.\n\nDone.')
  assert.deepEqual(owner.heard.filter((each) => each.type === 'delta'), mia.heard.filter((each) => each.type === 'delta'))
  assert.ok(mia.heard.some((each) => each.type === 'presence' && each.agent.state === 'working' && each.agent.step === 'Search the web'))
  assert.equal(mia.last('presence')?.agent.state, 'idle')
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/threads/ag_liveteam/live', headers: MIA })).json(), { object: 'thread_live', thread: 'ag_liveteam', turnId: null, seq: 0, text: '', agent: { state: 'idle' } })

  mia.ws.terminate()
  await until(() => owner.last('presence')?.people.length === 1)
  owner.ws.terminate()
  zed.ws.terminate()
})

async function follower(headers: Record<string, string>) {
  const heard: LiveDown[] = []
  const ws = await app.injectWS('/api/events', { headers }, { onInit: (socket) => socket.on('message', (data) => heard.push(JSON.parse(String(data)))) })
  await until(() => heard.length > 0)
  return {
    ws, heard,
    send: (message: unknown) => ws.send(JSON.stringify(message)),
    last: <T extends LiveDown['type']>(type: T) => heard.findLast((each): each is Extract<LiveDown, { type: T }> => each.type === type),
    delta: () => heard.flatMap((each) => each.type === 'delta' ? [each.text] : []).join(''),
  }
}

async function until(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((wait) => setTimeout(wait, 10))
  assert.ok(done())
}

async function closed(ws: WebSocket) {
  const [code, reason] = await once(ws, 'close')
  return { code, reason: String(reason) }
}
