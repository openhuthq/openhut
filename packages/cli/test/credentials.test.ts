import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rmSync, statSync } from 'node:fs'
import { CREDENTIALS_FILE, load, save, session } from '../src/credentials.ts'
import { fakeJakebox } from './fake-jakebox.ts'

const HOUR_MS = 3_600_000
const stored = { url: 'http://127.0.0.1:9', clientId: 'jbc_cli', accessToken: 'jbo_old', refreshToken: 'jbr_old', expiresAt: new Date(Date.now() + HOUR_MS).toISOString() }
const expired = new Date(Date.now() - 1000).toISOString()

test('credentials are saved readable only by you and load back', () => {
  save(stored)
  assert.equal(statSync(CREDENTIALS_FILE).mode & 0o777, 0o600)
  assert.deepEqual(load(), stored)
})

test('without credentials, you are told to sign in', () => {
  rmSync(CREDENTIALS_FILE, { force: true })
  assert.throws(load, /Sign in first with jakebox login <url>/)
})

test('a token that is still valid is used without asking the server', async () => {
  save(stored)
  assert.deepEqual(await session(), stored)
})

test('an expired access token is refreshed and the rotated refresh token is saved', async () => {
  const jakebox = await fakeJakebox({
    'POST /api/oauth/token': ({ body }) => {
      const form = new URLSearchParams(body)
      const valid = form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'jbr_old' && form.get('client_id') === 'jbc_cli'
      if (!valid) return [400, { error: 'invalid_grant', error_description: 'That refresh token was already used or revoked.' }]
      return [200, { access_token: 'jbo_new', token_type: 'Bearer', expires_in: 3600, refresh_token: 'jbr_new', scope: 'mcp' }]
    },
  })
  save({ ...stored, url: jakebox.url, expiresAt: expired })
  assert.equal((await session()).accessToken, 'jbo_new')
  const saved = load()
  assert.equal(saved.refreshToken, 'jbr_new')
  assert.ok(Date.parse(saved.expiresAt) > Date.now() + HOUR_MS - 60_000)
  assert.equal(statSync(CREDENTIALS_FILE).mode & 0o777, 0o600)
  jakebox.close()
})

test('a refresh token that was used or revoked tells you to sign in again', async () => {
  const jakebox = await fakeJakebox({ 'POST /api/oauth/token': () => [400, { error: 'invalid_grant', error_description: 'That refresh token was already used or revoked.' }] })
  save({ ...stored, url: jakebox.url, expiresAt: expired })
  await assert.rejects(session(), { message: `Your sign-in to ${jakebox.url} has ended. Run jakebox login ${jakebox.url} again.` })
  jakebox.close()
})
