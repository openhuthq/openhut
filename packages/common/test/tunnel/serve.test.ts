import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_REQUEST_BODY } from '../../src/tunnel/frames.ts'
import { connect, type TunnelError } from '../../src/tunnel/index.ts'
import { newDevice, startComputer, TOKEN, waitFor } from './relay.ts'

const closed = (error: TunnelError) => error.type === 'closed'

async function client() {
  const ctx = await startComputer()
  const device = newDevice()
  ctx.listed.add(device.hex)
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key, token: TOKEN })
  return { ctx, device, tunnel }
}

test('a request body over the limit gets 413 without reaching the handler', async () => {
  const { ctx, tunnel } = await client()
  const response = await tunnel.fetch('/upload', { method: 'POST', body: new Uint8Array(MAX_REQUEST_BODY + 1) })
  assert.equal(response.status, 413)
  assert.deepEqual(ctx.handled, [])
  tunnel.close()
  await ctx.close()
})

test('a request body of several MiB, like a moved agent, reaches the handler', async () => {
  const { ctx, tunnel } = await client()
  const fits = await tunnel.fetch('/upload', { method: 'POST', body: new Uint8Array(5 << 20) })
  assert.equal(fits.status, 200)
  assert.deepEqual(ctx.handled, ['POST /upload'])
  tunnel.close()
  await ctx.close()
})

for (const [name, tamper] of [
  ['replayed', (frames: Buffer[]) => [frames[0], frames[0], frames[1]]],
  ['reordered', (frames: Buffer[]) => [frames[1], frames[0]]],
  ['tampered', (frames: Buffer[]) => [Buffer.concat([frames[0].subarray(0, -1), Buffer.from([frames[0][frames[0].length - 1] ^ 1])]), frames[1]]]
] as const) {
  test(`a ${name} frame closes the session without starting the request`, async () => {
    const { ctx, tunnel } = await client()
    const held: Buffer[] = []
    ctx.relay.intercept = frame => {
      held.push(frame)
      return held.length === 2 ? tamper(held) : []
    }
    await assert.rejects(tunnel.fetch('/secret'), closed)
    await assert.rejects(tunnel.fetch('/again'), closed)
    assert.deepEqual(ctx.handled, [])
    await ctx.close()
  })
}

test('a replayed handshake message 1 does not start a request', async () => {
  const { ctx, tunnel } = await client()
  assert.equal((await tunnel.fetch('/once')).status, 200)
  const recorded = ctx.relay.frames.slice(0, 3)
  const replay = new (WebSocket as unknown as new (url: string, init: { headers: Record<string, string> }) => WebSocket)(`${ctx.relay.url}/v1/tunnels/${ctx.computer.id}?role=device`, { headers: { 'x-openhut-token': TOKEN } })
  const answers: unknown[] = []
  replay.addEventListener('message', event => answers.push(event.data))
  replay.addEventListener('open', () => recorded.forEach(frame => replay.send(new Uint8Array(frame))))
  const code = await new Promise<number>(resolve => replay.addEventListener('close', event => resolve(event.code)))
  assert.equal(code, 4003)
  assert.equal(answers.length, 1)
  assert.deepEqual(ctx.handled, ['GET /once'])
  tunnel.close()
  await ctx.close()
})

test('a removed device is told it was removed, then closed', async () => {
  const { ctx, device, tunnel } = await client()
  assert.equal((await tunnel.fetch('/before')).status, 200)
  ctx.listed.delete(device.hex)
  await assert.rejects(tunnel.fetch('/after'), (error: TunnelError) => error.type === 'removed' && error.message === 'This device was removed.')
  await assert.rejects(tunnel.fetch('/again'), closed)
  assert.deepEqual(ctx.handled, ['GET /before'])
  await ctx.close()
})

test('an unknown key is told it was removed, then closed', async () => {
  const ctx = await startComputer()
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: newDevice().key, token: TOKEN })
  await assert.rejects(tunnel.fetch('/agents'), (error: TunnelError) => error.type === 'removed')
  await assert.rejects(tunnel.fetch('/again'), closed)
  assert.deepEqual(ctx.handled, [])
  await ctx.close()
})

test('a computer key cannot open a session as a device when it is not listed', async () => {
  const ctx = await startComputer()
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: ctx.key, token: TOKEN })
  await assert.rejects(tunnel.fetch('/agents'), (error: TunnelError) => error.type === 'removed')
  assert.deepEqual(ctx.handled, [])
  await ctx.close()
})

test('the computer pings the relay and, when the pongs stop, drops the socket and registers again', async () => {
  const ctx = await startComputer({ keepalive: { every: 20, within: 100 } })
  await waitFor(() => ctx.relay.pongs >= 3)
  assert.equal(ctx.relay.registered, 1)
  ctx.relay.deaf = true
  await waitFor(() => ctx.relay.registered === 2)
  ctx.relay.deaf = false
  const device = newDevice()
  ctx.listed.add(device.hex)
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key, token: TOKEN })
  assert.equal((await tunnel.fetch('/after')).status, 200)
  tunnel.close()
  await ctx.close()
})

test('an unknown device cannot open a socket', async () => {
  const ctx = await startComputer()
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: newDevice().key, token: TOKEN })
  const socket = tunnel.socket('/live')
  const closes: number[] = []
  socket.onclose = event => closes.push(event.code)
  await waitFor(() => closes.length === 1)
  assert.deepEqual(closes, [4403])
  assert.deepEqual(ctx.sockets, [])
  await ctx.close()
})

test('a removed device cannot open a socket, and removing a device closes the sockets it has open', async () => {
  const { ctx, device, tunnel } = await client()
  ctx.listed.delete(device.hex)
  const refused = tunnel.socket('/refused')
  const refusals: { code: number; reason: string }[] = []
  refused.onclose = event => refusals.push(event)
  await waitFor(() => refusals.length === 1)
  assert.deepEqual(refusals, [{ code: 4403, reason: 'This device was removed.' }])
  assert.deepEqual(ctx.sockets, [])
  await ctx.close()

  const again = await client()
  const socket = again.tunnel.socket('/live')
  const got: unknown[] = []
  const closes: { code: number; reason: string }[] = []
  socket.onmessage = event => got.push(event.data)
  socket.onclose = event => closes.push(event)
  socket.send('before')
  await waitFor(() => got.length === 1)
  again.ctx.listed.delete(again.device.hex)
  socket.send('after')
  await waitFor(() => closes.length === 1)
  assert.deepEqual(got, ['before'])
  assert.deepEqual(closes, [{ code: 4403, reason: 'This device was removed.' }])
  await waitFor(() => again.ctx.sockets.includes('closed /live'))
  await assert.rejects(again.tunnel.fetch('/again'), closed)
  await again.ctx.close()
})

test('a message from the device over 1 MiB closes that socket with 1009', async () => {
  const { ctx, tunnel } = await client()
  const socket = tunnel.socket('/live')
  const closes: { code: number; reason: string }[] = []
  socket.onclose = event => closes.push(event)
  socket.send(new Uint8Array(1024 * 1024 + 1))
  await waitFor(() => closes.length === 1)
  assert.deepEqual(closes, [{ code: 1009, reason: 'That message is too big.' }])
  await waitFor(() => ctx.sockets.includes('closed /live'))
  assert.equal((await tunnel.fetch('/after')).status, 200)
  tunnel.close()
  await ctx.close()
})

test('the relay refuses a device without a valid access token', async () => {
  const ctx = await startComputer()
  const device = newDevice()
  ctx.listed.add(device.hex)
  await assert.rejects(connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key, token: 'forged' }), (error: TunnelError) => error.type === 'offline')
  assert.deepEqual(ctx.handled, [])
  await ctx.close()
})

test('a computer the relay refuses for its token tries again soon, not only after the keepalive runs out', async () => {
  const ctx = await startComputer({ token: async () => 'expired', keepalive: { every: 1000, within: 60_000 } })
  await new Promise(resolve => setTimeout(resolve, 1500))
  assert.equal(ctx.relay.registered, 0)
  assert.ok(ctx.relay.refused >= 2)
  await ctx.close()
})
