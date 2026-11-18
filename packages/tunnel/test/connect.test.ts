import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect, TunnelError } from '../src/index.ts'
import { nativeKey, newDevice, startComputer, startRelay, waitFor } from './relay.ts'

test('a request and its response cross the tunnel, with only the allowed headers', async () => {
  const seen: Record<string, string>[] = []
  const big = 'x'.repeat(200_000)
  const ctx = await startComputer({
    handle: async request => {
      seen.push(request.headers)
      const body = await new Response(request.body).text()
      return Response.json({ method: request.method, path: request.path, body, big }, { status: 201, headers: { 'x-answer': '42' } })
    }
  })
  const device = newDevice()
  ctx.statuses.set(device.hex, 'client')
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key })
  const response = await tunnel.fetch('/api/agents?limit=2', { method: 'POST', body: JSON.stringify({ name: 'Ada' }), headers: { 'content-type': 'application/json', authorization: 'Bearer nope' } })
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('x-answer'), '42')
  assert.deepEqual(await response.json(), { method: 'POST', path: '/api/agents?limit=2', body: '{"name":"Ada"}', big })
  assert.deepEqual(seen, [{ 'content-type': 'application/json' }])
  assert.equal((await tunnel.fetch('/empty', { method: 'DELETE' })).status, 201)
  tunnel.close()
  await ctx.close()
})

test('a streamed response arrives in chunks before it ends', async () => {
  let release = () => {}
  const released = new Promise<void>(resolve => { release = resolve })
  const encoder = new TextEncoder()
  const ctx = await startComputer({
    handle: async () => new Response(new ReadableStream<Uint8Array>({
      start: controller => {
        controller.enqueue(encoder.encode('data: one\n\n'))
        released.then(() => {
          controller.enqueue(encoder.encode('data: two\n\n'))
          controller.close()
        })
      }
    }), { headers: { 'content-type': 'text/event-stream' } })
  })
  const device = newDevice()
  ctx.statuses.set(device.hex, 'client')
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key })
  const response = await tunnel.fetch('/events', { headers: { accept: 'text/event-stream', 'last-event-id': '7' } })
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  const reader = response.body?.getReader()
  assert.ok(reader)
  const decoder = new TextDecoder()
  assert.equal(decoder.decode((await reader.read()).value), 'data: one\n\n')
  release()
  assert.equal(decoder.decode((await reader.read()).value), 'data: two\n\n')
  assert.equal((await reader.read()).done, true)
  tunnel.close()
  await ctx.close()
})

test('a device whose key only offers async agree completes IK and exchanges requests', async () => {
  const ctx = await startComputer()
  const native = nativeKey()
  ctx.statuses.set(native.hex, 'client')
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: native.key })
  assert.equal(native.agreed.length, 2)
  assert.equal(native.agreed[0], ctx.computer.key)
  for (const path of ['/one', '/two']) assert.deepEqual(await (await tunnel.fetch(path)).json(), { path, body: '' })
  assert.deepEqual(ctx.handled, ['GET /one', 'GET /two'])
  tunnel.close()
  await ctx.close()
})

test('a computer that is not connected to the relay is offline', async () => {
  const relay = await startRelay()
  const device = newDevice()
  await assert.rejects(connect({ relayUrl: relay.url, computer: { id: 'ab'.repeat(32), key: 'cd'.repeat(32) }, key: device.key }), (error: TunnelError) => error.type === 'offline')
  await relay.close()
})

test('the computer reconnects to the relay after the socket drops', async () => {
  const ctx = await startComputer()
  const device = newDevice()
  ctx.statuses.set(device.hex, 'client')
  ctx.relay.kickComputer()
  await waitFor(() => !ctx.relay.online())
  await waitFor(ctx.relay.online)
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key })
  assert.equal((await tunnel.fetch('/after')).status, 200)
  tunnel.close()
  await ctx.close()
})

test('a closing notice from the relay is acted on at once, without waiting for the socket to close', async () => {
  const { WebSocketServer } = await import('ws')
  const server = new WebSocketServer({ port: 0 })
  server.on('connection', socket => socket.send(JSON.stringify({ type: 'closing', code: 4004, reason: 'offline 0' })))
  const { port } = server.address() as { port: number }
  const started = Date.now()
  await assert.rejects(connect({ relayUrl: `ws://127.0.0.1:${port}`, computer: { id: 'ab'.repeat(32), key: 'cd'.repeat(32) }, key: newDevice().key }), (error: TunnelError) => error.type === 'offline')
  assert.ok(Date.now() - started < 1000)
  for (const client of server.clients) client.terminate()
  server.close()
})
