import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { startComputer, TOKEN } from './relay.ts'

test('a web page in Chrome opens the tunnel with a WebCrypto key and its token as a subprotocol', { timeout: 60_000 }, async () => {
  const ctx = await startComputer()
  const bundle = await build({ entryPoints: [new URL('./browser/page.ts', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'browser', alias: { 'sodium-native': 'sodium-javascript' }, logLevel: 'error' })
  let done: (body: { answer?: unknown; error?: string }) => void = () => {}
  const result = new Promise<{ answer?: unknown; error?: string }>(resolve => { done = resolve })
  const site = createServer(async (req, res) => {
    const body = req.method === 'POST' ? JSON.parse(await new Response(req as unknown as ReadableStream).text()) : undefined
    if (req.url === '/key') {
      ctx.listed.add(body.key)
      return res.end(JSON.stringify({ relayUrl: ctx.relay.url, computer: ctx.computer, token: TOKEN }))
    }
    if (req.url === '/result') {
      done(body)
      return res.end()
    }
    if (req.url === '/page.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle.outputFiles[0]?.text)
    res.writeHead(200, { 'content-type': 'text/html' }).end('<script type="module" src="/page.js"></script>')
  }).listen(0, '127.0.0.1')
  await once(site, 'listening')
  const browser = await chromium.launch({ channel: 'chrome' })
  await (await browser.newPage()).goto(`http://127.0.0.1:${(site.address() as AddressInfo).port}/`)
  try {
    const { answer, error } = await result
    assert.equal(error, undefined)
    assert.deepEqual(answer, { path: '/api/me', body: '' })
  } finally {
    await browser.close()
    site.close()
    await ctx.close()
  }
})
