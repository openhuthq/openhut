import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from '@openhut/tunnel'
import { startComputer, startRelay, waitFor } from '../../tunnel/test/relay.ts'
import { ownerKeys } from '../src/owner-keys.mjs'
import { reacher, urlOf } from '../src/reach.mjs'

const safeStorage = {
  encryptStringAsync: async (text: string) => Buffer.from(text),
  decryptStringAsync: async (data: Buffer) => ({ result: String(data) }),
}

async function mac() {
  return ownerKeys({ dir: join(mkdtempSync(join(tmpdir(), 'oh-reach-')), 'keys'), safeStorage, name: 'Mac' })
}

function setup({ relayUrl, keys }: { relayUrl: string; keys: Awaited<ReturnType<typeof mac>> }) {
  const opened: string[] = []
  const direct: string[] = []
  const { reach, socket } = reacher({
    relayUrl,
    key: async () => keys.device,
    connect: (input: Parameters<typeof connect>[0]) => {
      opened.push(input.computer.id)
      return connect(input)
    },
    direct: async ({ computer, path }: { computer: { name: string }; path: string }) => {
      direct.push(`${computer.name} ${path}`)
      return Response.json({ direct: true })
    },
  })
  return { reach, socket, opened, direct }
}

test('a computer with a relay key is reached through one tunnel session with the Mac\'s device key; one without (this computer\'s own runtime on Linux) is reached directly', async () => {
  const ctx = await startComputer()
  const keys = await mac()
  ctx.statuses.set(keys.self.key, 'client')
  const { reach, opened, direct } = setup({ relayUrl: ctx.relay.url, keys })
  const office = { id: 'a1b2c3d4', name: 'Office', key: ctx.computer.key }
  for (const path of ['/api/agents', '/api/admin']) assert.deepEqual(await (await reach({ computer: office, path, init: {} })).json(), { path, body: '' })
  assert.deepEqual(opened, [ctx.computer.id])
  assert.deepEqual(ctx.handled, ['GET /api/agents', 'GET /api/admin'])
  assert.deepEqual(await (await reach({ computer: { id: 'local', name: 'This computer', url: 'http://127.0.0.1:8787' }, path: '/api/agents', init: {} })).json(), { direct: true })
  assert.deepEqual(direct, ['This computer /api/agents'])
  ctx.relay.kickComputer()
  await waitFor(async () => {
    const answer = await reach({ computer: office, path: '/api/me', init: {} }).catch(() => undefined)
    return answer?.status === 200
  })
  assert.equal(opened.length >= 2, true)
  assert.equal(ctx.handled.at(-1), 'GET /api/me')
  await ctx.close()
})

test('a relay computer that is offline is offline', async () => {
  const relay = await startRelay()
  const keys = await mac()
  const { reach, direct } = setup({ relayUrl: relay.url, keys })
  await assert.rejects(reach({ computer: { id: 'x', name: 'Office', key: 'cd'.repeat(32) }, path: '/api/admin', init: {} }), /Office is offline/)
  assert.deepEqual(direct, [])
  await relay.close()
})

test('the live view of a relay computer opens a socket on the same tunnel session as its requests', async () => {
  const ctx = await startComputer()
  const keys = await mac()
  ctx.statuses.set(keys.self.key, 'client')
  const { reach, socket, opened } = setup({ relayUrl: ctx.relay.url, keys })
  const office = { id: 'a1b2c3d4', name: 'Office', key: ctx.computer.key }
  assert.equal((await reach({ computer: office, path: '/api/me', init: {} })).status, 200)
  const live = await socket({ computer: office, path: '/api/browsers/agt_1/live?fps=30' })
  const got: unknown[] = []
  live.onmessage = ({ data }: { data: unknown }) => got.push(data)
  live.send('{"type":"ack","seq":1}')
  await waitFor(() => got.length === 1)
  assert.deepEqual(got, ['{"type":"ack","seq":1}'])
  assert.deepEqual(opened, [ctx.computer.id])
  assert.deepEqual(ctx.sockets, ['/api/browsers/agt_1/live?fps=30'])
  live.close()
  await ctx.close()
})

test('a computer added over Tailscale is dialed straight at its tailnet address; one on the relay goes through the relay', () => {
  assert.equal(urlOf({ id: 'a1', name: 'Office', key: 'k' }), undefined)
  assert.equal(urlOf({ id: 'a1', name: 'homelab', key: 'k', tailnet: { dns: 'homelab.tail4e2a.ts.net', ip: '100.88.14.3', port: 8788 } }), 'ws://100.88.14.3:8788')
  assert.equal(urlOf({ id: 'a1', name: 'homelab', key: 'k', tailnet: { dns: 'homelab.tail4e2a.ts.net', ip: 'fd7a:115c:a1e0::1', port: 8788 } }), 'ws://[fd7a:115c:a1e0::1]:8788')
})
