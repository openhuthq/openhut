import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { github } from '../../../src/integrations/github/github.ts'

test('the bot is registered under the organization and comes back to the callback twice', () => {
  const { authorizationUrl, manifest } = github.registration({ name: 'acme-hut', organization: 'acme', homeUrl: 'https://fm.example', redirectUrl: 'https://fm.example/cb', state: 's1' })
  assert.equal(authorizationUrl, 'https://github.com/organizations/acme/settings/apps/new?state=s1')
  const parsed = JSON.parse(manifest)
  assert.equal(parsed.redirect_url, 'https://fm.example/cb')
  assert.equal(parsed.setup_url, 'https://fm.example/cb')
  assert.equal(parsed.public, false)
  assert.equal(github.registration({ name: 'x', homeUrl: 'h', redirectUrl: 'r', state: 's' }).authorizationUrl, 'https://github.com/settings/apps/new?state=s')
})

test('git_credentials signs as the app and hands git a one-hour token and the bot identity', async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
  const seen: { url: string; authorization: string }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') ?? '' })
    return Response.json({ token: 'ghs_fresh' }, { status: 201 })
  })
  const result = await github.connector.call({ config: { appId: 42, slug: 'acme-hut', pem, installationId: 7, botId: 99 }, save: async () => undefined, tool: 'git_credentials', args: {} })
  assert.equal(seen[0].url, 'https://api.github.com/app/installations/7/access_tokens')
  const [header, payload, signature] = seen[0].authorization.replace('Bearer ', '').split('.')
  assert.ok(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, signature, 'base64url'))
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url').toString()).iss, 42)
  assert.match(result.text, /password=ghs_fresh/)
  assert.match(result.text, /user\.email '99\+acme-hut\[bot\]@users\.noreply\.github\.com'/)
  await assert.rejects(github.connector.call({ config: { headers: {} }, save: async () => undefined, tool: 'git_credentials', args: {} }), /connect GitHub again/)
})
