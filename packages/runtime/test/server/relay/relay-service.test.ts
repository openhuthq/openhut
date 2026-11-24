import { test } from 'node:test'
import assert from 'node:assert/strict'
import websocket from '@fastify/websocket'
import Fastify from 'fastify'
import { bodyOf, signList } from '@openhut/common/cloud/member-list.ts'
import { boxKey, identity, toBase64 } from '@openhut/common/vault/vault.ts'
import { connect, toHex, type TunnelError } from '@openhut/tunnel'
import { startRelay, TOKEN, waitFor } from '@openhut/tunnel/test/relay.ts'

const relay = await startRelay()
const { config } = await import('../../../src/server/platform/config.ts')
config.relayUrl = relay.url
const { keyStore } = await import('../../../src/server/cloud/key-store.ts')
const { keysService } = await import('../../../src/server/cloud/keys-service.ts')
const { migrate } = await import('../../../src/server/platform/db.ts')
const { answerErrors } = await import('../../../src/server/platform/http-error.ts')
const { relayIdOf, relayService, tunnelKey } = await import('../../../src/server/relay/relay-service.ts')
const { who } = await import('../../../src/server/team/identity.ts')

await migrate()
let release = () => {}
const released = new Promise<void>((resolve) => { release = resolve })

const app = Fastify()
answerErrors(app)
app.get('/api/threads/:id', async (req) => who(req))
app.post<{ Body: unknown }>('/api/threads/:id/files/lookups', async (req) => ({ got: req.body, caller: await who(req) }))
app.post('/api/threads/:id/chat', async (req, reply) => {
  await who(req)
  reply.hijack()
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream' })
  reply.raw.write('data: one\n\n')
  await released
  reply.raw.end('data: two\n\n')
})
app.post('/api/agents', async (req) => who(req))
app.delete('/api/cloud/devices/:key', async (req) => who(req))
await app.register(websocket)
app.get('/api/browsers/:id/live', { websocket: true }, (socket, req) => {
  void who(req).then((caller) => socket.send(JSON.stringify({ local: caller.local })), () => socket.close(4403, 'Not yours.'))
  socket.on('message', (data, binary) => socket.send(data, { binary }))
})
await app.ready()

const phone = await identity()
const phoneKey = await boxKey(phone.secret)
const listed = async (devices: string[]) => {
  const account = await keysService.open({ sub: 'google-mo', email: 'mo@example.com' })
  const body = bodyOf(account.list)
  const me = await keysService.device()
  assert.ok(body?.members[0])
  const list = await signList({ signer: me, body: { ...body, version: body.version + 1, members: [{ ...body.members[0], devices: [toBase64(me.publicKey), ...devices] }] } })
  await keyStore.write({ ...await keyStore.read(), account: { ...account, list } })
}
await listed([toBase64(phone.publicKey)])
await relayService.start({ server: app.server })

test('with no session the runtime stays off the relay; once signed in it comes on with its device key\'s X25519 half', async () => {
  assert.equal(relayService.state().relay, false)
  await keysService.setSession({ token: TOKEN, expiresAt: new Date(Date.now() + 3600_000).toISOString() })
  await relayService.sync()
  await waitFor(relay.online)
  assert.equal(relayService.state().relay, true)
  assert.equal(toHex((await tunnelKey()).publicKey), toHex((await keysService.device()).publicKey.slice(32)))
})

const computer = async () => {
  const key = (await tunnelKey()).publicKey
  return { id: relayIdOf(key), key: toHex(key) }
}

test('your listed viewer\'s request through the relay reaches an allowed route as you, never local, and its body arrives', async () => {
  const tunnel = await connect({ relayUrl: relay.url, computer: await computer(), key: phoneKey, token: TOKEN })
  const caller = await tunnel.fetch('/api/threads/th_one')
  assert.equal(caller.status, 200)
  const { email, local } = await caller.json() as { email: string; local: boolean }
  assert.deepEqual([email, local], ['mo@example.com', false])
  const echo = await tunnel.fetch('/api/threads/th_one/files/lookups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: ['a'] }) })
  assert.deepEqual(((await echo.json()) as { got: unknown }).got, { paths: ['a'] })
  tunnel.close()
})

test('through the relay your own device can make an agent, but gets 403 on a trust route like removing a device', async () => {
  const tunnel = await connect({ relayUrl: relay.url, computer: await computer(), key: phoneKey, token: TOKEN })
  const made = await tunnel.fetch('/api/agents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'From the browser' }) })
  assert.equal(made.status, 200)
  assert.equal((await tunnel.fetch('/api/cloud/devices/someone', { method: 'DELETE' })).status, 403)
  tunnel.close()
})

test('a streamed chat answer arrives in chunks, the first before the route has finished', async () => {
  const tunnel = await connect({ relayUrl: relay.url, computer: await computer(), key: phoneKey, token: TOKEN })
  const response = await tunnel.fetch('/api/threads/th_one/chat', { method: 'POST' })
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  assert.equal(response.headers.get('transfer-encoding'), null)
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader()
  assert.equal((await reader.read()).value, 'data: one\n\n')
  release()
  assert.equal((await reader.read()).value, 'data: two\n\n')
  assert.equal((await reader.read()).done, true)
  tunnel.close()
})

test('a live browser socket through the relay opens a real WebSocket on the runtime as you, never local, and echoes both ways', async () => {
  const tunnel = await connect({ relayUrl: relay.url, computer: await computer(), key: phoneKey, token: TOKEN })
  const socket = tunnel.socket('/api/browsers/ag_one/live')
  const got: (string | ArrayBuffer)[] = []
  const closes: number[] = []
  socket.onmessage = (event) => got.push(event.data)
  socket.onclose = (event) => closes.push(event.code)
  socket.send('hello')
  socket.send(new Uint8Array(100_000).fill(9))
  await waitFor(() => got.length === 3)
  assert.deepEqual(got.slice(0, 2), [JSON.stringify({ local: false }), 'hello'])
  assert.deepEqual(new Uint8Array(got[2] as ArrayBuffer), new Uint8Array(100_000).fill(9))
  socket.close()
  assert.deepEqual(closes, [1000])
  tunnel.close()
})

test('a key no member list holds is told it was removed', async () => {
  const stranger = await boxKey((await identity()).secret)
  const tunnel = await connect({ relayUrl: relay.url, computer: await computer(), key: stranger, token: TOKEN })
  await assert.rejects(tunnel.fetch('/api/threads/th_one'), (error: TunnelError) => error.type === 'removed')
})

test('a device you removed from your list is told so on its next request', async () => {
  const tunnel = await connect({ relayUrl: relay.url, computer: await computer(), key: phoneKey, token: TOKEN })
  assert.equal((await tunnel.fetch('/api/threads/th_one')).status, 200)
  await listed([])
  await assert.rejects(tunnel.fetch('/api/threads/th_one'), (error: TunnelError) => error.type === 'removed')
})

test.after(async () => {
  relayService.stop()
  await app.close()
  await relay.close()
})
