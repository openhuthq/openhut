import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { validatorCompiler } from 'fastify-type-provider-zod'
import '../../../src/plugins/chat/index.ts'
import { notified, notifyController, notifyPrompt, notifyTool } from '../../../src/plugins/chat/notify.ts'
import { agentService } from '../../../src/server/agents/agent-service.ts'
import { channelService } from '../../../src/server/channels/channel-service.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { refresh, signIn } from '../../server/agents/signed-in.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_ntfyownr', email: 'notify@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_ntfyagnt', name: 'Police', owner_id: 'usr_ntfyownr', instructions: '#', model: 'sonnet', net: 95, channel_key: seal('k'.repeat(48)) }).execute()
signIn({ email: 'notify@example.com' })
await refresh()
const alerts = { platform: 'discord', chat_id: '111', chat_name: '#alerts' }
const ops = { platform: 'discord', chat_id: '222', chat_name: '#ops' }
mock.method(channelService, 'places', async () => [alerts, ops])
const posted = mock.method(channelService, 'send', async () => ({ url: '', messageId: '' }))
mock.method(agentService, 'reapply', async () => undefined)
const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validatorCompiler)
await app.register(notifyController, { prefix: '/api/agents/:id/notify' })
const as = { authorization: 'Bearer test-key' }
test.after(() => app.close())

const agent = { id: 'ag_ntfyagnt', owner_id: 'usr_ntfyownr', net: 95 }
const run = (input: { text: string; place?: string }) => notifyTool.run(input, { agent, origin: { platform: 'api_server', chat_id: 'openhut-x' } })

test('notify posts in the default place, or a named one, and the turn\'s reply shows where it went', async () => {
  const since = new Date()
  assert.deepEqual(await run({ text: 'DB down' }), { text: 'You have no default place to notify. Pass place as one of: #alerts, #ops.', isError: true })
  const put = await app.inject({ method: 'PUT', url: '/api/agents/ag_ntfyagnt/notify', headers: as, payload: { default: alerts, rules: ' Outages to #alerts. ' } })
  assert.deepEqual(put.json(), { default: alerts, rules: 'Outages to #alerts.' })
  assert.deepEqual((await app.inject({ method: 'GET', url: '/api/agents/ag_ntfyagnt/notify', headers: as })).json(), { default: alerts, rules: 'Outages to #alerts.' })
  assert.equal(await run({ text: 'DB down' }), 'Posted in #alerts.')
  assert.equal(await run({ text: 'Fixed', place: 'OPS' }), 'Posted in #ops.')
  assert.deepEqual(posted.mock.calls.map((call) => call.arguments[0]), [{ agentId: 'ag_ntfyagnt', place: alerts, text: 'DB down' }, { agentId: 'ag_ntfyagnt', place: ops, text: 'Fixed' }])
  assert.deepEqual(notified({ agentId: 'ag_ntfyagnt', since }), { type: 'data-notified', data: [{ place: alerts, text: 'DB down' }, { place: ops, text: 'Fixed' }] })
  assert.equal(notified({ agentId: 'ag_ntfyagnt', since: new Date(Date.now() + 1000) }), undefined)
})

test('the default must be a place the agent can post in, and the rules reach its prompt', async () => {
  const bad = await app.inject({ method: 'PUT', url: '/api/agents/ag_ntfyagnt/notify', headers: as, payload: { default: { ...alerts, chat_id: '999' }, rules: '' } })
  assert.equal(bad.statusCode, 400)
  const row = await db.selectFrom('agent').select('notify').where('id', '=', 'ag_ntfyagnt').executeTakeFirstOrThrow()
  assert.match(notifyPrompt(row.notify), /default place is #alerts on discord\.\nYour owner's rules for where and when to notify:\nOutages to #alerts\.$/)
  assert.equal(notifyPrompt(null), '')
})
