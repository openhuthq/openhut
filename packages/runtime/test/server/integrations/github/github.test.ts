import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { github } from '../../../../src/server/integrations/github/github.ts'
import { settings } from '../../../../src/server/platform/settings.ts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const APP = { id: 42, slug: 'acme-openhut', name: 'acme-openhut', owner: 'acme', ownerType: 'Organization' as const, ownerAvatar: 'https://avatars.githubusercontent.com/u/1', pem: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), botId: 99 }

test('the server\'s app is made on the chosen owner, comes back to this server, and installs come back to the connection callback', () => {
  const org = github.manifest({ organization: 'acme', name: 'acme-openhut', address: 'https://agents.acme.dev', state: 's1' })
  assert.equal(org.url, 'https://github.com/organizations/acme/settings/apps/new?state=s1')
  const manifest = JSON.parse(org.manifest)
  assert.equal(manifest.name, 'acme-openhut')
  assert.equal(manifest.url, 'https://openhut.dev')
  assert.equal(manifest.redirect_url, 'https://agents.acme.dev/api/github-app/callback')
  assert.equal(manifest.setup_url, 'https://agents.acme.dev/api/connection-authorizations/callback')
  assert.equal(manifest.public, false)
  assert.equal(github.manifest({ name: 'mo-openhut', address: 'https://a.b', state: 's' }).url, 'https://github.com/settings/apps/new?state=s')
  assert.equal(github.settingsUrl(APP), 'https://github.com/organizations/acme/settings/apps/acme-openhut')
  assert.equal(github.settingsUrl({ ...APP, ownerType: 'User', owner: 'mo' }), 'https://github.com/settings/apps/acme-openhut')
  assert.equal(github.installUrl({ app: APP, state: 'x' }), 'https://github.com/apps/acme-openhut/installations/new?state=x')
})

test('the manifest code becomes the stored app, with its owner and bot', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url: string) => String(url).includes('/app-manifests/')
    ? Response.json({ id: 42, slug: 'acme-openhut', name: 'acme-openhut', pem: APP.pem, owner: { login: 'acme', type: 'Organization', avatar_url: APP.ownerAvatar } }, { status: 201 })
    : Response.json({ id: 99, login: 'acme-openhut[bot]' }))
  assert.deepEqual(await github.created('code1'), APP)
})

test('git_credentials routes git through the gateway as the server app\'s bot; connections from the old app-per-connect say to reconnect', async () => {
  await settings.setGithubApp(APP)
  const result = await github.connector.call({ config: { installationId: 7 }, refresh: async () => ({}), tool: 'git_credentials', args: {} })
  assert.match(result.text, /url\."\$OPENHUT_GATEWAY\/u\/github\/"\.insteadOf https:\/\/github\.com\//)
  assert.match(result.text, /user\.email '99\+acme-openhut\[bot\]@users\.noreply\.github\.com'/)
  assert.doesNotMatch(result.text, /password|ghs_|x-access-token/)
  await assert.rejects(github.connector.call({ config: { appId: 1, slug: 'old', pem: 'x', installationId: 7, botId: 1 }, refresh: async () => ({}), tool: 'git_credentials', args: {} }), /Reconnect it/)
  await settings.setGithubApp(null)
  await assert.rejects(github.connector.call({ config: { installationId: 7 }, refresh: async () => ({}), tool: 'git_credentials', args: {} }), /Settings › Admin › GitHub/)
})

test('the gateway\'s token is minted as the server app, then cached', async (t) => {
  await settings.setGithubApp(APP)
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
  await db.insertInto('connection').values({ id: 'cn_ghtokenn', kind: 'github', name: 'GitHub', owner_id: 'usr_ghtokenn', config: seal(JSON.stringify({ installationId: 8 })), created_at: new Date() }).execute()
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

test('a connection limited to some repositories gets a token for only those; installations list their repositories', async (t) => {
  await settings.setGithubApp(APP)
  github.forgetTokens()
  const seen: { path: string; body?: string }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname
    seen.push({ path, body: init?.body as string | undefined })
    if (path === '/app/installations') return Response.json([{ id: 5, account: { login: 'acme', type: 'Organization', avatar_url: 'https://a/acme' } }])
    if (path === '/installation/repositories') return Response.json({ total_count: 2, repositories: [{ name: 'app' }, { name: 'docs' }] })
    return Response.json({ token: `ghs_${seen.length}` }, { status: 201 })
  })
  await github.connector.tools({ config: { installationId: 5, repositories: ['app'] }, refresh: async () => ({}) }).catch(() => undefined)
  assert.equal(seen[0].path, '/app/installations/5/access_tokens')
  assert.deepEqual(JSON.parse(seen[0].body ?? '{}'), { repositories: ['app'] })
  assert.deepEqual(await github.installations(), [{ installationId: 5, account: { login: 'acme', type: 'Organization', avatarUrl: 'https://a/acme' }, repositories: ['app', 'docs'], total: 2 }])
  assert.equal(seen.filter((each) => each.path === '/app/installations/5/access_tokens').length, 2)
  assert.equal(seen.at(-2)?.body, undefined)
})
