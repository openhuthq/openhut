import { test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { validatorCompiler } from 'fastify-type-provider-zod'
import '../../../src/plugins/inbox/index.ts'
import { setupCard, setupController, showWebhookSetup } from '../../../src/plugins/inbox/setup.ts'
import { inboxService } from '../../../src/server/inbox/inbox-service.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { refresh, signIn } from '../../server/agents/signed-in.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_setupown', email: 'setup@example.com', role: 'owner', removed_at: null }).execute()
for (const id of ['ag_setupone', 'ag_setuptwo']) await db.insertInto('agent').values({ id, name: id, owner_id: 'usr_setupown', instructions: '#', model: 'sonnet', net: id.endsWith('one') ? 96 : 97, channel_key: seal('k'.repeat(48)) }).execute()
signIn({ email: 'setup@example.com' })
await refresh()
const owner = { id: 'usr_setupown', email: 'setup@example.com', role: 'owner' as const }
const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_setupone', name: 'DO alerts' })
const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validatorCompiler)
await app.register(setupController, { prefix: '/api/agents/:id/webhooks' })
const as = { authorization: 'Bearer test-key' }
test.after(() => app.close())

const input = { webhookId: hook.id, title: 'Send DigitalOcean alerts here', steps: ['Open Monitoring', 'Add a webhook'] }
const agent = (id: string) => ({ id, owner_id: 'usr_setupown', net: 96 })

test('in the app the setup is a card with the real webhook, fetched only by the owner with its secret', async () => {
  const since = new Date()
  assert.match(String(await showWebhookSetup.run(input, { agent: agent('ag_setupone'), origin: { platform: 'api_server', chat_id: 'openhut-x' } })), /setup card is in the chat/)
  assert.deepEqual(setupCard({ agentId: 'ag_setupone', since }), { type: 'data-webhook-setup', data: input })
  const res = await app.inject({ method: 'GET', url: `/api/agents/ag_setupone/webhooks/${hook.id}/setup`, headers: as })
  assert.deepEqual(res.json(), { object: 'webhook_setup', address: hook.url, secret: hook.secret })
  assert.equal((await app.inject({ method: 'GET', url: `/api/agents/ag_setuptwo/webhooks/${hook.id}/setup`, headers: as })).statusCode, 404)
})

test('off the app it gives the real address and no secret, and another agent\'s webhook is refused', async () => {
  const text = String(await showWebhookSetup.run(input, { agent: agent('ag_setupone'), origin: { platform: 'discord', chat_id: '1' } }))
  assert.ok(text.includes(`Address: ${hook.url}`))
  assert.ok(text.includes('Secret: copy it from OpenHut'))
  assert.ok(!text.includes(hook.secret))
  await assert.rejects(showWebhookSetup.run(input, { agent: agent('ag_setuptwo'), origin: {} }), /no webhook/)
})
