import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync } from 'node:crypto'
import { asks } from '../../../src/core/asks.ts'
import { installWaits } from '../../../src/plugins/github/waits.ts'
import { connectionAuthorizationService } from '../../../src/server/connections/connection-authorization-service.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { settings } from '../../../src/server/platform/settings.ts'
import { fakeAgentd, refresh, signIn } from '../../server/agents/signed-in.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_ghwaitow', email: 'wait@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_ghwaitag', name: 'Database', owner_id: 'usr_ghwaitow', instructions: '#', model: 'claude:sonnet', net: 72, channel_key: seal('k'.repeat(48)) }).execute()
fakeAgentd()
signIn({ email: 'wait@example.com' })
await refresh()
const actor = { id: 'usr_ghwaitow', email: 'wait@example.com', role: 'owner' as const }
await settings.setGithubApp({ id: 7, slug: 'acme-openhut', name: 'acme-openhut', owner: 'acme', ownerType: 'Organization', ownerAvatar: '', pem: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), botId: 99, logo: true })
installWaits.start()

test('an install request waits for the owner, and the ask is approved once the new installation shows up', async (t) => {
  let installed: { id: number; account: object }[] = []
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const path = new URL(input).pathname
    if (path === '/app/installations') return Response.json(installed)
    if (path === '/app/installations/9') return Response.json(installed[0])
    if (path === '/installation/repositories') return Response.json({ total_count: 1, repositories: [{ name: 'app' }] })
    if (path.endsWith('/access_tokens')) return Response.json({ token: 'ghs_x' }, { status: 201 })
    return new Response('{}', { status: 500 })
  })
  const said = await asks.create({ agentId: 'ag_ghwaitag', kind: 'connect_app', input: { app: 'github' }, why: 'PRs', origin: { platform: 'api_server', chat_id: 'openhut-msg_ghwait01' } })
  const askId = /\((ask_[a-z0-9]+)\)/.exec(said)?.[1] ?? ''
  const started = await connectionAuthorizationService.create({ actor, kind: 'github', askId, permissions: { read: 'allow', create: 'ask' } })
  const back = await connectionAuthorizationService.finish({ state: started.id, setup_action: 'request' })
  assert.match(back.error ?? '', /connects it as soon as they approve/)
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.deepEqual((await installWaits.waiting({ askIds: [askId] })).map((each) => each.askId), [askId])
  await installWaits.poll()
  assert.equal((await asks.get({ actor, id: askId })).status, 'open')
  installed = [{ id: 9, account: { login: 'acme', type: 'Organization', avatar_url: 'https://a/acme' } }]
  await installWaits.poll()
  assert.equal((await asks.get({ actor, id: askId })).status, 'done')
  assert.deepEqual(await installWaits.waiting({ askIds: [askId] }), [])
  const grant = await db.selectFrom('connection_grant as g').innerJoin('connection as c', 'c.id', 'g.connection_id').select(['c.kind', 'c.account']).where('g.agent_id', '=', 'ag_ghwaitag').executeTakeFirst()
  assert.deepEqual(grant, { kind: 'github', account: 'acme · acme-openhut[bot]' })
})
