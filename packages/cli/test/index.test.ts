import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CREDENTIALS_FILE, load, save } from '../src/credentials.ts'
import { challengeOf } from '../src/oauth.ts'
import { fakeJakebox } from './fake-jakebox.ts'

const CLI = fileURLToPath(new URL('../src/index.ts', import.meta.url))
const SIGN_IN_LINK = /http\S+\/mcp\/authorize\?\S+/
const owner = { id: 'per_1', object: 'person', username: 'owner', role: 'owner', joinedAt: '2026-11-01T00:00:00.000Z' }
const agent = {
  id: 'ag_1', object: 'agent', name: 'support-bot', ownerId: 'per_1', ownerName: 'owner', model: 'sonnet', wanted: 'running', status: 'running',
  summary: '', net: 1, instructions: '', canEdit: true, createdAt: '2026-11-01T00:00:00.000Z',
}

test('login signs in through the browser redirect and saves the tokens for you alone', async () => {
  let challenge = ''
  const jakebox = await fakeJakebox({
    'POST /api/oauth/clients': ({ body }) => [201, { client_id: 'jbc_cli', redirect_uris: JSON.parse(body).redirect_uris }],
    'POST /api/oauth/token': ({ body }) => {
      const form = new URLSearchParams(body)
      if (form.get('code') !== 'jba_code' || challengeOf(form.get('code_verifier') ?? '') !== challenge) return [400, { error: 'invalid_grant' }]
      return [200, { access_token: 'jbo_new', token_type: 'Bearer', expires_in: 3600, refresh_token: 'jbr_new', scope: 'mcp' }]
    },
    'GET /api/me': ({ authorization }) => authorization === 'Bearer jbo_new'
      ? [200, { object: 'me', user: owner, publicUrl: 'http://jb.test' }]
      : [401, { error: { type: 'invalid_request_error', message: 'Sign in first.' } }],
  })
  const login = cli(['login', jakebox.url])
  const link = await new Promise<URL>((resolve) => login.child.stdout.on('data', () => {
    const found = SIGN_IN_LINK.exec(login.output.stdout)
    if (found) resolve(new URL(found[0]))
  }))
  challenge = link.searchParams.get('code_challenge') ?? ''
  const back = new URL(link.searchParams.get('redirect_uri') ?? '')
  back.search = new URLSearchParams({ code: 'jba_other', state: 'not-the-state' }).toString()
  assert.equal((await fetch(back)).status, 400)
  back.search = new URLSearchParams({ code: 'jba_code', state: link.searchParams.get('state') ?? '' }).toString()
  assert.equal((await fetch(back)).status, 200)
  const { code, stdout } = await login.done
  assert.equal(code, 0)
  assert.match(stdout, /Signed in to http:\/\/127\.0\.0\.1:\d+ as owner\./)
  assert.equal(load().accessToken, 'jbo_new')
  assert.equal(statSync(CREDENTIALS_FILE).mode & 0o777, 0o600)
  jakebox.close()
})

test('agents lists each agent, and an API error is printed with exit code 1', async () => {
  const jakebox = await fakeJakebox({
    'GET /api/agents': ({ authorization }) => authorization === 'Bearer jbo_now'
      ? [200, { object: 'list', url: '/api/agents', hasMore: false, data: [agent] }]
      : [401, { error: { type: 'invalid_request_error', message: 'Sign in first.' } }],
    'POST /api/invites': () => [403, { error: { type: 'invalid_request_error', message: 'Only an owner or admin can invite people.' } }],
  })
  save({ url: jakebox.url, clientId: 'jbc_cli', accessToken: 'jbo_now', refreshToken: 'jbr_now', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  const listed = await cli(['agents']).done
  assert.equal(listed.code, 0)
  assert.deepEqual(listed.stdout.trim().split('\n').map((line) => line.split(/\s+/)), [['NAME', 'STATUS', 'MODEL', 'OWNER'], ['support-bot', 'running', 'sonnet', 'owner']])
  const refused = await cli(['invite']).done
  assert.equal(refused.code, 1)
  assert.equal(refused.stderr.trim(), 'Only an owner or admin can invite people.')
  jakebox.close()
})

function cli(args: string[]) {
  const child = spawn(process.execPath, [CLI, ...args])
  const output = { stdout: '', stderr: '' }
  child.stdout.on('data', (chunk) => { output.stdout += chunk })
  child.stderr.on('data', (chunk) => { output.stderr += chunk })
  const done = once(child, 'close').then(([code]) => ({ code, ...output }))
  return { child, output, done }
}

test('login refuses a server whose sign-in endpoints are on another address', async () => {
  const elsewhere = { authorization_endpoint: 'https://elsewhere.test/mcp/authorize', token_endpoint: 'https://elsewhere.test/api/oauth/token', registration_endpoint: 'https://elsewhere.test/api/oauth/clients' }
  const jakebox = await fakeJakebox({ 'GET /.well-known/oauth-authorization-server': () => [200, elsewhere] })
  const login = await cli(['login', jakebox.url]).done
  assert.equal(login.code, 1)
  assert.equal(login.stderr.trim(), `${jakebox.url} says its address is https://elsewhere.test. Run jakebox login https://elsewhere.test instead.`)
  jakebox.close()
})

test('logout forgets an unreadable sign-in and says to disconnect it on Admin', async () => {
  writeFileSync(CREDENTIALS_FILE, '{not json')
  const out = await cli(['logout']).done
  assert.equal(out.code, 0)
  assert.match(out.stdout, /disconnect the app on Admin too\.$/m)
  assert.equal(existsSync(CREDENTIALS_FILE), false)
})
