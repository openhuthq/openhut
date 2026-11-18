import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { connect, sixDigits, verifyProof, type Hello, type Invited, type TunnelError } from '../src/index.ts'
import { newDevice, startComputer, waitFor } from './relay.ts'

const closed = (error: TunnelError) => error.type === 'closed'

async function client() {
  const ctx = await startComputer()
  const device = newDevice()
  ctx.statuses.set(device.hex, 'client')
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key })
  return { ctx, device, tunnel }
}

test('a request body over 1 MiB gets 413 without reaching the handler', async () => {
  const { ctx, tunnel } = await client()
  const response = await tunnel.fetch('/upload', { method: 'POST', body: new Uint8Array(1024 * 1024 + 1) })
  assert.equal(response.status, 413)
  assert.deepEqual(ctx.handled, [])
  const fits = await tunnel.fetch('/upload', { method: 'POST', body: new Uint8Array(1024 * 1024) })
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
  const replay = new WebSocket(`${ctx.relay.url}/v1/relay/${ctx.computer.id}?role=device`)
  const answers: unknown[] = []
  replay.addEventListener('message', event => answers.push(event.data))
  replay.addEventListener('open', () => recorded.forEach(frame => replay.send(frame)))
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
  ctx.statuses.set(device.hex, 'removed')
  await assert.rejects(tunnel.fetch('/after'), (error: TunnelError) => error.type === 'removed' && error.message === 'This device was removed.')
  for await (const message of tunnel.control) assert.fail(`unexpected ${JSON.stringify(message)}`)
  await assert.rejects(tunnel.fetch('/again'), closed)
  assert.deepEqual(ctx.handled, ['GET /before'])
  await ctx.close()
})

test('an unknown key gets closed without an answer', async () => {
  const ctx = await startComputer()
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: newDevice().key })
  await assert.rejects(tunnel.fetch('/agents'), closed)
  assert.deepEqual(ctx.handled, [])
  await ctx.close()
})

test('a computer key cannot open a session as a device when device() says unknown', async () => {
  const ctx = await startComputer()
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: ctx.key })
  await assert.rejects(tunnel.fetch('/agents'), closed)
  assert.deepEqual(ctx.handled, [])
  await ctx.close()
})

function pairing(secret: string) {
  const state: { calls: number; digits?: string; key?: string; hello?: Hello; approve: () => void } = { calls: 0, approve: () => {} }
  const approved = new Promise<void>(resolve => { state.approve = resolve })
  const invited = async ({ key, proof, handshakeHash, hello }: { key: string; proof: string; handshakeHash: Uint8Array; hello: Hello }): Promise<Invited | null> => {
    state.calls++
    if (!(await verifyProof({ secret, handshakeHash, proof }))) return null
    Object.assign(state, { key, hello, digits: await sixDigits(handshakeHash) })
    return {
      accept: async function* () {
        await approved
        yield { type: 'accepted', access: { object: 'access', version: 1 } }
      }
    }
  }
  return { state, invited }
}

test('pairing with the wrong secret is rejected', async () => {
  const { state, invited } = pairing(randomBytes(32).toString('hex'))
  const ctx = await startComputer({ invited })
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: newDevice().key, invitation: { secret: randomBytes(32).toString('hex'), name: 'Phone', kind: 'client' } })
  const messages = []
  for await (const message of tunnel.control) messages.push(message)
  assert.deepEqual(messages, [])
  assert.equal(state.calls, 1)
  assert.equal(state.digits, undefined)
  await ctx.close()
})

test('pairing with the right secret shows the same six digits on both sides and is accepted once approved', async () => {
  const secret = randomBytes(32).toString('hex')
  const { state, invited } = pairing(secret)
  const ctx = await startComputer({ invited })
  const device = newDevice()
  const tunnel = await connect({ relayUrl: ctx.relay.url, computer: ctx.computer, key: device.key, invitation: { secret, name: 'Phone', kind: 'client' } })
  assert.match(tunnel.digits, /^\d{6}$/)
  await waitFor(() => state.digits !== undefined)
  assert.equal(state.digits, tunnel.digits)
  assert.equal(state.key, device.hex)
  assert.deepEqual(state.hello, { type: 'hello', proof: state.hello?.proof, name: 'Phone', kind: 'client' })
  state.approve()
  const control = tunnel.control[Symbol.asyncIterator]()
  assert.deepEqual((await control.next()).value, { type: 'accepted', access: { object: 'access', version: 1 } })
  ctx.statuses.set(device.hex, 'client')
  assert.equal((await tunnel.fetch('/after-join')).status, 200)
  tunnel.close()
  await ctx.close()
})
