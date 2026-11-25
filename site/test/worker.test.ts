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
  assert.ok(lines.includes('/docs /install 302'))
})
