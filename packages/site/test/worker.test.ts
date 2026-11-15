import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/worker.ts'

const FILES: Record<string, [string, string]> = {
  '/install.sh': ['#!/bin/sh\necho install\n', 'application/x-sh'],
  '/': ['<!doctype html><title>OpenHut</title>', 'text/html; charset=utf-8'],
  '/openhut.tgz': ['tarball', 'application/gzip'],
  '/changelog': ['<!doctype html><title>OpenHut Changelog</title>', 'text/html; charset=utf-8'],
}
const env = {
  ASSETS: {
    fetch: async (request: Request) => {
      const file = FILES[new URL(request.url).pathname]
      return file ? new Response(file[0], { headers: { 'content-type': file[1] } }) : new Response('Not found', { status: 404 })
    },
  },
}
const waits: Promise<unknown>[] = []
const ctx = { waitUntil: (promise: Promise<unknown>) => { waits.push(promise) } }
const get = (path: string, accept = '*/*') => worker.fetch(new Request(`https://openhut.dev${path}`, { headers: { accept, 'user-agent': 'curl/8.5.0' } }), env, ctx)

test('curl gets install.sh as plain text', async () => {
  const res = await get('/')
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8')
  assert.equal(await res.text(), '#!/bin/sh\necho install\n')
  assert.equal(res.headers.get('vary'), 'Accept')
})

test('a browser gets the home page with the page CSP', async () => {
  const res = await get('/', 'text/html,application/xhtml+xml')
  assert.match(await res.text(), /<title>OpenHut<\/title>/)
  assert.match(res.headers.get('content-security-policy') ?? '', /^default-src 'self'/)
})

test('the changelog is a page with the page CSP', async () => {
  const res = await get('/changelog', 'text/html')
  assert.match(await res.text(), /<title>OpenHut Changelog<\/title>/)
  assert.match(res.headers.get('content-security-policy') ?? '', /^default-src 'self'/)
})

test('the tarball is served as is, never cached by the edge', async () => {
  const res = await get('/openhut.tgz')
  assert.equal(await res.text(), 'tarball')
  assert.equal(res.headers.get('cache-control'), 'no-cache')
  assert.equal(res.headers.get('content-security-policy'), null)
})

const sent: { url: string; auth: string | null; body: Record<string, unknown> }[] = []
const realFetch = globalThis.fetch
function captureBasket({ fail = false } = {}) {
  sent.length = 0
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    if (fail) throw new Error('basket is down')
    sent.push({ url: String(input), auth: new Headers(init?.headers).get('authorization'), body: JSON.parse(String(init?.body)) })
    return new Response(null, { status: 200 })
  }
}
const settle = async () => { await Promise.all(waits.splice(0)) }
const keyed = { ...env, DATABUDDY_API_KEY: 'dbdy_test' }
const post = (body: unknown, host = 'openhut.dev') => worker.fetch(new Request(`https://${host}/api/events`, { method: 'POST', body: JSON.stringify(body) }), keyed, ctx)
const INSTANCE = '0b9c2f2e-3c1d-4b6a-9f1e-2a7d5c8e1f00'

test('the hub forwards known events from a server to Databuddy with only the allowed properties', async () => {
  captureBasket()
  const res = await post({ instance: INSTANCE, version: '0.2.9', events: [
    { name: 'agent_created', properties: { model: 'sonnet', name: 'Payroll bot' }, at: 1 },
    { name: 'made_up', properties: {} },
    { name: 'channel_connected', properties: { kind: 'has spaces and is far too long to be a real kind of channel' } },
  ] })
  assert.equal(res.status, 202)
  await settle()
  globalThis.fetch = realFetch
  assert.deepEqual(sent.map(({ url, auth, body }) => ({ url, auth, name: body.name, anonymousId: body.anonymousId, properties: body.properties })), [
    { url: 'https://basket.databuddy.cc/track', auth: 'Bearer dbdy_test', name: 'agent_created', anonymousId: INSTANCE, properties: { model: 'sonnet', version: '0.2.9' } },
    { url: 'https://basket.databuddy.cc/track', auth: 'Bearer dbdy_test', name: 'channel_connected', anonymousId: INSTANCE, properties: { version: '0.2.9' } },
  ])
})

test('the hub refuses a malformed batch and forwards nothing from a preview or local host', async () => {
  captureBasket()
  assert.equal((await post({ instance: 'not-a-uuid', version: '1', events: [] })).status, 400)
  assert.equal((await post({ instance: INSTANCE, version: '1', events: [{ name: 'agent_deleted' }] }, 'preview.openhut.workers.dev')).status, 202)
  await settle()
  globalThis.fetch = realFetch
  assert.equal(sent.length, 0)
})

test('serving install.sh and the release counts a download, and still works when Databuddy is down', async () => {
  captureBasket({ fail: true })
  const script = await worker.fetch(new Request('https://openhut.dev/', { headers: { 'user-agent': 'curl/8.5.0' } }), keyed, ctx)
  const tarball = await worker.fetch(new Request('https://openhut.dev/openhut.tgz'), keyed, ctx)
  assert.equal(await script.text(), '#!/bin/sh\necho install\n')
  assert.equal(await tarball.text(), 'tarball')
  await settle()
  captureBasket()
  await worker.fetch(new Request('https://openhut.dev/', { headers: { 'user-agent': 'curl/8.5.0' } }), keyed, ctx)
  await settle()
  globalThis.fetch = realFetch
  assert.deepEqual(sent.map(({ body }) => [body.name, body.properties]), [['install_script_fetched', { client: 'curl' }]])
})
