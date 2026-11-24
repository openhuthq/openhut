import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect, newWebKeyPair, toHex, TunnelError, webKey, type TunnelSocket } from '../src/index.ts'
import { nativeKey, newDevice, startComputer, startRelay, TOKEN, waitFor } from './relay.ts'

test('a request and its response cross the tunnel, with only the allowed headers and the body length', async () => {
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
  ctx.listed.add(device.hex)
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key, token: TOKEN })
  const response = await tunnel.fetch('/api/agents?limit=2', { method: 'POST', body: JSON.stringify({ name: 'Ada' }), headers: { 'content-type': 'application/json', authorization: 'Bearer nope' } })
  assert.equal(response.status, 201)
  assert.equal(response.headers.get('x-answer'), '42')
  assert.deepEqual(await response.json(), { method: 'POST', path: '/api/agents?limit=2', body: '{"name":"Ada"}', big })
  assert.deepEqual(seen, [{ 'content-type': 'application/json', 'content-length': '14' }])
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
  ctx.listed.add(device.hex)
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key, token: TOKEN })
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
  ctx.listed.add(native.hex)
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: native.key, token: TOKEN })
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
  await assert.rejects(connect({ relayUrl: relay.url, computer: { id: 'ab'.repeat(32), key: 'cd'.repeat(32) }, key: device.key, token: TOKEN }), (error: TunnelError) => error.type === 'offline')
  await relay.close()
})

test('the computer reconnects to the relay after the socket drops', async () => {
  const ctx = await startComputer()
  const device = newDevice()
  ctx.listed.add(device.hex)
  ctx.relay.kickComputer()
  await waitFor(() => !ctx.relay.online())
  await waitFor(ctx.relay.online)
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key, token: TOKEN })
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
  await assert.rejects(connect({ relayUrl: `ws://127.0.0.1:${port}`, computer: { id: 'ab'.repeat(32), key: 'cd'.repeat(32) }, key: newDevice().key, token: TOKEN }), (error: TunnelError) => error.type === 'offline')
  assert.ok(Date.now() - started < 1000)
  for (const client of server.clients) client.terminate()
  server.close()
})

test('a handshake that never gets an answer fails as closed after the timeout and closes the socket', async () => {
  const { WebSocketServer } = await import('ws')
  const server = new WebSocketServer({ port: 0 })
  const gone = new Promise(resolve => server.on('connection', socket => socket.on('close', resolve)))
  const { port } = server.address() as { port: number }
  const started = Date.now()
  await assert.rejects(connect({ relayUrl: `ws://127.0.0.1:${port}`, computer: { id: 'ab'.repeat(32), key: 'cd'.repeat(32) }, key: newDevice().key, token: TOKEN, timeout: 100 }), (error: TunnelError) => error.type === 'closed')
  assert.ok(Date.now() - started < 1000)
  await gone
  server.close()
})

function inbox(socket: TunnelSocket) {
  const got: (string | ArrayBuffer)[] = []
  const closes: { code: number; reason: string }[] = []
  socket.onmessage = event => got.push(event.data)
  socket.onclose = event => closes.push(event)
  return { got, closes }
}

test('a socket echoes text, binary and a message over 65 000 bytes across the tunnel', async () => {
  const ctx = await startComputer()
  const device = newDevice()
  ctx.listed.add(device.hex)
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key, token: TOKEN })
  const socket = tunnel.socket('/api/browsers/agt_1/live?fps=30')
  assert.equal(socket.binaryType, 'arraybuffer')
  const { got } = inbox(socket)
  const big = 'é'.repeat(100_000)
  socket.send('hello')
  socket.send(new Uint8Array([1, 2, 3]))
  socket.send(big)
  socket.send(new Uint8Array(200_000).fill(7))
  socket.send('')
  await waitFor(() => got.length === 5)
  assert.equal(got[0], 'hello')
  assert.deepEqual(new Uint8Array(got[1] as ArrayBuffer), new Uint8Array([1, 2, 3]))
  assert.equal(got[2], big)
  assert.deepEqual(new Uint8Array(got[3] as ArrayBuffer), new Uint8Array(200_000).fill(7))
  assert.equal(got[4], '')
  assert.deepEqual(ctx.sockets, ['/api/browsers/agt_1/live?fps=30'])
  tunnel.close()
  await ctx.close()
})

test('closing a socket on the device closes the computer\'s side, and the tunnel still works', async () => {
  const ctx = await startComputer()
  const device = newDevice()
  ctx.listed.add(device.hex)
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key, token: TOKEN })
  const socket = tunnel.socket('/live')
  const { closes } = inbox(socket)
  socket.send('one')
  socket.close()
  assert.equal(socket.readyState, 3)
  assert.deepEqual(closes, [{ code: 1000, reason: '' }])
  await waitFor(() => ctx.sockets.includes('closed /live'))
  assert.equal((await tunnel.fetch('/after')).status, 200)
  tunnel.close()
  await ctx.close()
})

test('the computer closing a socket reaches the device with its code and reason', async () => {
  const ctx = await startComputer({
    socket: async ({ send, close }) => ({ send: data => data === 'bye' ? close({ code: 4409, reason: 'The browser is off.' }) : send(data), close: () => {} })
  })
  const device = newDevice()
  ctx.listed.add(device.hex)
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key, token: TOKEN })
  const socket = tunnel.socket('/live')
  const { got, closes } = inbox(socket)
  socket.send('still here')
  socket.send('bye')
  await waitFor(() => closes.length === 1)
  assert.deepEqual(got, ['still here'])
  assert.deepEqual(closes, [{ code: 4409, reason: 'The browser is off.' }])
  assert.equal(socket.readyState, 3)
  tunnel.close()
  await ctx.close()
})

test('a lost tunnel closes its sockets', async () => {
  const ctx = await startComputer()
  const device = newDevice()
  ctx.listed.add(device.hex)
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key, token: TOKEN })
  const socket = tunnel.socket('/live')
  const { closes } = inbox(socket)
  socket.send('ping')
  await waitFor(() => ctx.sockets.length === 1)
  ctx.relay.kickComputer()
  await waitFor(() => closes.length === 1)
  assert.equal(closes[0].code, 1006)
  await waitFor(() => ctx.sockets.includes('closed /live'))
  tunnel.close()
  await ctx.close()
})

test('a browser-style device: a WebCrypto key that never leaves the key store, and its token sent as a subprotocol', async () => {
  const ctx = await startComputer()
  const pair = await newWebKeyPair()
  assert.equal(pair.privateKey.extractable, false)
  const key = await webKey(pair)
  ctx.listed.add(toHex(key.publicKey))
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key, token: TOKEN })
  assert.deepEqual(await (await tunnel.fetch('/api/me')).json(), { path: '/api/me', body: '' })
  tunnel.close()
  await ctx.close()
})
