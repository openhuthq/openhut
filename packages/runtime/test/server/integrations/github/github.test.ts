import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { github } from '../../../../src/server/integrations/github/github.ts'

test('the bot is registered under the organization and comes back to the callback twice', () => {
  const { authorizationUrl, manifest } = github.registration({ name: 'acme-hut', organization: 'acme', homeUrl: 'https://fm.example', redirectUrl: 'https://fm.example/cb', state: 's1' })
  assert.equal(authorizationUrl, 'https://github.com/organizations/acme/settings/apps/new?state=s1')
  const parsed = JSON.parse(manifest)
  assert.equal(parsed.redirect_url, 'https://fm.example/cb')
  assert.equal(parsed.setup_url, 'https://fm.example/cb')
  assert.equal(parsed.public, false)
  assert.equal(github.registration({ name: 'x', homeUrl: 'h', redirectUrl: 'r', state: 's' }).authorizationUrl, 'https://github.com/settings/apps/new?state=s')
})

test('git_credentials routes git through the gateway and sets the bot identity, with no token in it', async () => {
  const result = await github.connector.call({ config: { appId: 42, slug: 'acme-hut', pem: 'unused', installationId: 7, botId: 99 }, refresh: async () => ({}), tool: 'git_credentials', args: {} })
  assert.match(result.text, /url\."\$OPENHUT_GATEWAY\/u\/github\/"\.insteadOf https:\/\/github\.com\//)
  assert.match(result.text, /extraHeader" "Authorization: Agent \$OPENHUT_AGENT_TOKEN"/)
  assert.match(result.text, /user\.email '99\+acme-hut\[bot\]@users\.noreply\.github\.com'/)
  assert.doesNotMatch(result.text, /password|ghs_|x-access-token/)
  await assert.rejects(github.connector.call({ config: { headers: {} }, refresh: async () => ({}), tool: 'git_credentials', args: {} }), /connect GitHub again/)
})

test('the gateway\'s token is minted as the app, then cached', async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
  const seen: { url: string; authorization: string }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization') ?? '' })
    return Response.json({ token: 'ghs_fresh' }, { status: 201 })
  })
  const { db, migrate } = await import('../../../../src/server/platform/db.ts')
  const { seal } = await import('../../../../src/server/platform/secrets.ts')
  await migrate()
  await db.insertInto('person').values({ id: 'usr_ghtokenn', email: 'gh@example.com', role: 'owner', removed_at: null }).execute()
  await db.insertInto('agent').values({ id: 'ag_ghtokenn', name: 'Dev', owner_id: 'usr_ghtokenn', instructions: '#', model: 'sonnet', net: 13, channel_key: seal('k'.repeat(32)) }).execute()
  await db.insertInto('connection').values({ id: 'cn_ghtokenn', kind: 'github', name: 'GitHub', owner_id: 'usr_ghtokenn', config: seal(JSON.stringify({ appId: 42, slug: 'acme-hut', pem, installationId: 8, botId: 99 })), created_at: new Date() }).execute()
  await assert.rejects(github.gitToken({ agentId: 'ag_ghtokenn' }), /No GitHub connection is granted/)
  await db.insertInto('connection_grant').values({ id: 'gr_ghtokenn', connection_id: 'cn_ghtokenn', agent_id: 'ag_ghtokenn', created_at: new Date() }).execute()
  assert.equal(await github.gitToken({ agentId: 'ag_ghtokenn' }), 'ghs_fresh')
  assert.equal(await github.gitToken({ agentId: 'ag_ghtokenn' }), 'ghs_fresh')
  assert.equal(seen.length, 1)
  assert.equal(seen[0].url, 'https://api.github.com/app/installations/8/access_tokens')
  const [header, payload, signature] = seen[0].authorization.replace('Bearer ', '').split('.')
  assert.ok(createVerify('RSA-SHA256').update(`${header}.${payload}`).verify(publicKey, signature, 'base64url'))
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url').toString()).iss, 42)
})
