import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:net'
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import type { WebSocket } from 'ws'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { browserController } from '../../../src/server/agents/browser-controller.ts'

const KEY = { authorization: 'Bearer test-key' }
const heard: string[] = []
const agentd = createServer((sock) => {
  sock.setEncoding('utf8').on('data', (chunk: string) => {
    for (const line of chunk.split('\n').filter(Boolean)) {
      heard.push(line)
      if (JSON.parse(line).cmd === 'browser-live') sock.write('{"data":"/9j/","seq":1,"type":"frame"}\n')
    }
  })
}).listen(process.env.AGENTD_SOCK)
agentd.unref()

await migrate()
await db.insertInto('person').values({ id: 'usr_browsown', email: 'owner@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_browseon', name: 'Scout', owner_id: 'usr_browsown', instructions: '# Scout', model: 'sonnet', net: 21, channel_key: seal('k'.repeat(32)), web_browser: true }).execute()
await db.insertInto('agent').values({ id: 'ag_browseof', name: 'Ops', owner_id: 'usr_browsown', instructions: '# Ops', model: 'sonnet', net: 22, channel_key: seal('k'.repeat(32)) }).execute()

const app = Fastify()
await app.register(websocket)
await app.register(browserController, { prefix: '/api/browsers' })
await app.ready()

test('the live view is refused without the key, from another site, and while the agent\'s browser is off', async () => {
  assert.deepEqual(await closed(await app.injectWS('/api/browsers/ag_browseon/live')), { code: 4401, reason: 'Send the key the OpenHut app enrolled with this computer, as Authorization: Bearer <key>.' })
  assert.equal((await closed(await app.injectWS('/api/browsers/ag_browseon/live', { headers: { ...KEY, origin: 'https://evil.example' } }))).code, 4403)
  assert.deepEqual(await closed(await app.injectWS('/api/browsers/ag_browseof/live', { headers: KEY })), { code: 4409, reason: 'Turn on Browser for Ops first.' })
})

test('frames come down as agent-browser sent them and the viewer\'s acks go up to agentd', async () => {
  const ws = await app.injectWS('/api/browsers/ag_browseon/live?fps=2', { headers: KEY })
  const [frame] = await once(ws, 'message')
  assert.equal(String(frame), '{"data":"/9j/","seq":1,"type":"frame"}')
  ws.send('{"type":"ack","seq":1}')
  for (let i = 0; i < 50 && !heard.includes('{"type":"ack","seq":1}'); i++) await new Promise((done) => setTimeout(done, 10))
  assert.deepEqual(JSON.parse(heard[0] ?? ''), { cmd: 'browser-live', id: 'ag_browseon', fps: 2 })
  assert.ok(heard.includes('{"type":"ack","seq":1}'))
  ws.terminate()
})

async function closed(ws: WebSocket) {
  const [code, reason] = await once(ws, 'close')
  return { code, reason: String(reason) }
}
