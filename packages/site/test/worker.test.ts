import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/worker.ts'

test('curl and wget are sent to the stable install.sh on dl.openhut.dev at /, browsers and bots get the site', async () => {
  const env = { ASSETS: { fetch: async () => new Response('<!doctype html><title>OpenHut</title>', { headers: { 'content-type': 'text/html' } }) } } as never
  const ctx = { waitUntil: () => {} } as never
  const get = (path: string, headers: Record<string, string>) => worker.fetch(new Request(`https://openhut.dev${path}`, { headers }), env, ctx)
  for (const headers of [{ accept: '*/*', 'user-agent': 'curl/8.5.0' }, { accept: '*/*', 'user-agent': 'Wget/1.21.4' }, { 'user-agent': 'curl/8.5.0' }] as Record<string, string>[]) {
    const res = await get('/', headers)
    assert.equal(res.status, 302, headers['user-agent'])
    assert.equal(res.headers.get('location'), 'https://dl.openhut.dev/channels/stable/install.sh')
  }
  assert.match(await (await get('/', { accept: 'text/html,application/xhtml+xml', 'user-agent': 'Mozilla/5.0' })).text(), /<title>OpenHut/)
  assert.match(await (await get('/', { accept: '*/*', 'user-agent': 'Slackbot-LinkExpanding 1.0' })).text(), /<title>OpenHut/)
})

// Installed servers update from OPENHUT_URL=https://openhut.dev/install.sh (agentd/update.ts); the assets layer serves this redirect.
test('openhut.dev/install.sh redirects to the stable install.sh', async () => {
  const { readFile } = await import('node:fs/promises')
  const lines = (await readFile(new URL('../public/_redirects', import.meta.url), 'utf8')).split('\n').map((line) => line.trim())
  assert.ok(lines.includes('/install.sh https://dl.openhut.dev/channels/stable/install.sh 302'))
  assert.ok(lines.includes('/install /docs/install/ 302'))
})

test('POST /api/events stores allow-listed events in Analytics Engine and drops everything else', async () => {
  const points: unknown[] = []
  const env = { EVENTS: { writeDataPoint: (point: unknown) => points.push(point) } } as never
  const post = (body: unknown) => worker.fetch(new Request('https://openhut.dev/api/events', { method: 'POST', body: JSON.stringify(body) }), env, {})
  const instance = '0b6f3c1e-2a4d-4e5f-8a9b-1c2d3e4f5a6b'
  const events = [
    { name: 'instance_active', properties: { agents: 3, email: 'a@b.c' }, at: Date.now() },
    { name: 'made_up', properties: {}, at: Date.now() },
  ]
  assert.equal((await post({ instance, version: '1.2.3', kind: 'server', extra: 'x', events })).status, 202)
  assert.deepEqual(points, [{ indexes: [instance], blobs: ['instance_active', '1.2.3', 'server'], doubles: [3] }])
  assert.equal((await post({ instance: 'not-a-uuid', version: '1.2.3', events })).status, 400)
  assert.equal((await post({ events: [{ name: 'instance_active', properties: { agents: 1 }, at: Date.now() }] })).status, 202)
  assert.equal(points.length, 1)
})

test('POST /api/faces stores a 64×64 PNG under its sha256 once and refuses anything else', async () => {
  const stored = new Map<string, ArrayBuffer>()
  const DL = { head: async (key: string) => stored.get(key) ?? null, put: async (key: string, value: ArrayBuffer) => stored.set(key, value) }
  let left = 2
  const FACES_LIMIT = { limit: async () => ({ success: left-- > 0 }) }
  const post = (body: Uint8Array) => worker.fetch(new Request('https://openhut.dev/api/faces', { method: 'POST', body }), { DL, FACES_LIMIT } as never, {})
  const png = (size: number) => {
    const bytes = new Uint8Array(64)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
    new DataView(bytes.buffer).setUint32(16, size)
    new DataView(bytes.buffer).setUint32(20, size)
    return bytes
  }
  const { createHash } = await import('node:crypto')
  const res = await post(png(64))
  assert.equal(res.status, 201)
  assert.deepEqual(await res.json(), { url: `https://dl.openhut.dev/a/${createHash('sha256').update(png(64)).digest('hex')}.png` })
  assert.equal(stored.size, 1)
  assert.equal((await post(png(512))).status, 400)
  assert.equal((await post(png(64))).status, 429)
})
