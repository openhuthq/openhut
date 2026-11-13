import { test } from 'node:test'
import assert from 'node:assert/strict'
import worker from '../src/worker.ts'

const FILES: Record<string, [string, string]> = {
  '/install.sh': ['#!/bin/sh\necho install\n', 'application/x-sh'],
  '/': ['<!doctype html><title>Fast Monkey</title>', 'text/html; charset=utf-8'],
  '/fastmonkey.tgz': ['tarball', 'application/gzip'],
}
const env = {
  ASSETS: {
    fetch: async (request: Request) => {
      const file = FILES[new URL(request.url).pathname]
      return file ? new Response(file[0], { headers: { 'content-type': file[1] } }) : new Response('Not found', { status: 404 })
    },
  },
}
const get = (path: string, accept = '*/*') => worker.fetch(new Request(`https://fastmonkey.dev${path}`, { headers: { accept } }), env)

test('curl gets install.sh as plain text', async () => {
  const res = await get('/')
  assert.equal(res.headers.get('content-type'), 'text/plain; charset=utf-8')
  assert.equal(await res.text(), '#!/bin/sh\necho install\n')
  assert.equal(res.headers.get('vary'), 'Accept')
})

test('a browser gets the home page with the page CSP', async () => {
  const res = await get('/', 'text/html,application/xhtml+xml')
  assert.match(await res.text(), /<title>Fast Monkey<\/title>/)
  assert.match(res.headers.get('content-security-policy') ?? '', /^default-src 'self'/)
})

test('the tarball is served as is, never cached by the edge', async () => {
  const res = await get('/fastmonkey.tgz')
  assert.equal(await res.text(), 'tarball')
  assert.equal(res.headers.get('cache-control'), 'no-cache')
  assert.equal(res.headers.get('content-security-policy'), null)
})
