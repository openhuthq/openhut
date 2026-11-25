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

const KEY = { authorization: 'Bearer test-key' }

await migrate()
await db.insertInto('person').values({ id: 'usr_liveown', email: 'owner@example.com', role: 'owner', removed_at: null }).execute()

const app = Fastify()
app.setValidatorCompiler(validatorCompiler)
await app.register(websocket)
await app.register(eventsController, { prefix: '/api/events' })
await app.ready()

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

async function until(done: () => boolean) {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((wait) => setTimeout(wait, 10))
  assert.ok(done())
}

async function closed(ws: WebSocket) {
  const [code, reason] = await once(ws, 'close')
  return { code, reason: String(reason) }
}
