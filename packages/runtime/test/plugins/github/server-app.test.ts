import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { serverAppController, serverAppService } from '../../../src/plugins/github/server-app.ts'
import { connectionAuthorizationService } from '../../../src/server/connections/connection-authorization-service.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { settings } from '../../../src/server/platform/settings.ts'

await migrate()
await db.insertInto('person').values([{ id: 'usr_ghappadm', email: 'admin@example.com', name: 'Ada', role: 'owner', removed_at: null }, { id: 'usr_ghappmem', email: 'mo@example.com', name: 'Mo', role: 'member', removed_at: null }]).execute()
const admin = { id: 'usr_ghappadm', email: 'admin@example.com', role: 'owner' as const }
const member = { id: 'usr_ghappmem', email: 'mo@example.com', role: 'member' as const }

test('with no server app, a member asks an admin, GitHub can\'t be connected, and only an admin starts the setup', async () => {
  await assert.rejects(connectionAuthorizationService.create({ actor: member, kind: 'github' }), /Settings › Admin › GitHub/)
  assert.equal((await serverAppService.ask({ actor: member })).asked, true)
  await serverAppService.ask({ actor: member })
  assert.deepEqual((await serverAppService.get({ actor: admin })).askedBy, ['Mo'])
  assert.deepEqual((await serverAppService.get({ actor: member })).askedBy, [])
  assert.throws(() => serverAppService.create({ actor: member, owner: 'acme', ownerType: 'Organization', name: 'acme-openhut' }), /owner or an admin/)
})

test('the setup posts the manifest to GitHub, the callback stores the app and opens the done step; connecting then installs it', async (t) => {
  const app = Fastify()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)
  await app.register(serverAppController, { prefix: '/api/github-app' })
  const { url } = serverAppService.create({ actor: admin, owner: 'acme', ownerType: 'Organization', name: 'acme-openhut' })
  const state = new URL(url).searchParams.get('state')
  const launch = await app.inject({ method: 'GET', url: `/api/github-app/launch?state=${state}` })
  assert.match(launch.body, /action="https:\/\/github.com\/organizations\/acme\/settings\/apps\/new\?state=/)
  assert.match(launch.body, /acme-openhut/)
  t.mock.method(globalThis, 'fetch', async (input: string) => String(input).includes('/app-manifests/')
    ? Response.json({ id: 7, slug: 'acme-openhut', name: 'acme-openhut', pem: 'pem', owner: { login: 'acme', type: 'Organization', avatar_url: 'https://a/acme' } }, { status: 201 })
    : Response.json({ id: 99 }))
  const back = await app.inject({ method: 'GET', url: `/api/github-app/callback?state=${state}&code=c1` })
  assert.equal(back.statusCode, 302)
  assert.equal(back.headers.location, '/settings/admin?open=github-done')
  assert.match((await app.inject({ method: 'GET', url: `/api/github-app/callback?state=${state}&code=c1` })).body, /expired or was already used/)
  assert.equal(settings.githubApp()?.slug, 'acme-openhut')
  assert.deepEqual(settings.githubAsks(), [])
  const started = await connectionAuthorizationService.create({ actor: member, kind: 'github' })
  assert.equal(started.authorizationUrl, `https://github.com/apps/acme-openhut/installations/new?state=${started.id}`)
  const asked = await connectionAuthorizationService.finish({ state: started.id, setup_action: 'request' })
  assert.match(asked.error ?? '', /install request to the account's owner/)
  assert.throws(() => serverAppService.create({ actor: admin, owner: 'acme', ownerType: 'Organization', name: 'x' }), /already has a GitHub App/)
  await serverAppService.remove({ actor: admin })
  assert.equal(settings.githubApp(), undefined)
})

test('a member gives access to picked repositories of an installation; repositories the app can\'t reach are refused', async (t) => {
  await settings.setGithubApp({ id: 7, slug: 'acme-openhut', name: 'acme-openhut', owner: 'acme', ownerType: 'Organization', ownerAvatar: '', pem: (await import('node:crypto')).generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), botId: 99 })
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const path = new URL(input).pathname
    if (path === '/app/installations') return Response.json([{ id: 5, account: { login: 'acme', type: 'Organization', avatar_url: 'https://a/acme' } }])
    if (path === '/app/installations/5') return Response.json({ id: 5, account: { login: 'acme', type: 'Organization', avatar_url: 'https://a/acme' } })
    if (path === '/installation/repositories') return Response.json({ total_count: 2, repositories: [{ name: 'app' }, { name: 'docs' }] })
    return Response.json({ token: 'ghs_x' }, { status: 201 })
  })
  assert.deepEqual((await serverAppService.installations()).map((each) => each.repositories), [['app', 'docs']])
  await assert.rejects(serverAppService.connect({ actor: member, installationId: 5, repositories: ['secret'] }), /can't reach acme\/secret/)
  const made = await serverAppService.connect({ actor: member, installationId: 5, repositories: ['docs', 'app'] })
  assert.equal(made.account, 'acme · 2 repos · acme-openhut[bot]')
  await settings.setGithubApp(null)
})
