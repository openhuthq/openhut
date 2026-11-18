import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from '@openhut/tunnel'
import { startComputer, startRelay, waitFor } from '../../tunnel/test/relay.ts'
import { ownerKeys } from '../src/owner-keys.mjs'
import { reacher } from '../src/reach.mjs'

const safeStorage = {
  encryptStringAsync: async (text: string) => Buffer.from(text),
  decryptStringAsync: async (data: Buffer) => ({ result: String(data) }),
}

async function mac() {
  return ownerKeys({ dir: join(mkdtempSync(join(tmpdir(), 'oh-reach-')), 'keys'), safeStorage, name: 'Mac' })
}

function setup({ relayUrl, keys }: { relayUrl: string; keys: Awaited<ReturnType<typeof mac>> }) {
  const opened: string[] = []
  const legacy: string[] = []
  const { reach } = reacher({
    relayUrl,
    key: async () => keys.device,
    connect: (input: Parameters<typeof connect>[0]) => {
      opened.push(input.computer.id)
      return connect(input)
    },
    legacy: async ({ computer, path }: { computer: { name: string }; path: string }) => {
      legacy.push(`${computer.name} ${path}`)
      return Response.json({ legacy: true })
    },
  })
  return { reach, opened, legacy }
}

test('a computer with a relay key is reached through one tunnel session with the Mac\'s device key; one without goes the old way', async () => {
  const ctx = await startComputer()
  const keys = await mac()
  ctx.statuses.set(keys.self.key, 'client')
  const { reach, opened, legacy } = setup({ relayUrl: ctx.relay.url, keys })
  const office = { id: 'a1b2c3d4', name: 'Office', key: ctx.computer.key }
  for (const path of ['/api/agents', '/api/admin']) assert.deepEqual(await (await reach({ computer: office, path, init: {} })).json(), { path, body: '' })
  assert.deepEqual(opened, [ctx.computer.id])
  assert.deepEqual(ctx.handled, ['GET /api/agents', 'GET /api/admin'])
  assert.deepEqual(await (await reach({ computer: { id: 'beef', name: 'Beelink', url: 'https://beelink.example' }, path: '/api/agents', init: {} })).json(), { legacy: true })
  assert.deepEqual(legacy, ['Beelink /api/agents'])
  ctx.relay.kickComputer()
  await waitFor(async () => {
    const answer = await reach({ computer: office, path: '/api/me', init: {} }).catch(() => undefined)
    return answer?.status === 200
  })
  assert.equal(opened.length >= 2, true)
  assert.equal(ctx.handled.at(-1), 'GET /api/me')
  await ctx.close()
})

test('a relay computer that is offline is offline, unless it still has its tailnet address to fall back on', async () => {
  const relay = await startRelay()
  const keys = await mac()
  const { reach, legacy } = setup({ relayUrl: relay.url, keys })
  const key = 'cd'.repeat(32)
  await assert.rejects(reach({ computer: { id: 'x', name: 'Office', key }, path: '/api/admin', init: {} }), /Office is offline/)
  assert.deepEqual(await (await reach({ computer: { id: 'y', name: 'Beelink', key, url: 'https://beelink.example' }, path: '/api/admin', init: {} })).json(), { legacy: true })
  assert.deepEqual(legacy, ['Beelink /api/admin'])
  await relay.close()
})
