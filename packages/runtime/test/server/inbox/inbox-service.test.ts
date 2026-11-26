import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { gatewayServer } from '../../../src/server/gateway/gateway-server.ts'
import { changeRequestService } from '../../../src/server/agents/change-request-service.ts'
import { inboxReceiver } from '../../../src/server/inbox/inbox-controller.ts'
import { inboxService } from '../../../src/server/inbox/inbox-service.ts'
import { routineService } from '../../../src/server/inbox/routines.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { agentToken, seal } from '../../../src/server/platform/secrets.ts'
import { runSet } from '../../../src/server/agents/run-set.ts'
import { fakeAgentd, refresh, signIn } from '../agents/signed-in.ts'

fakeAgentd()
await migrate()
await db.insertInto('person').values({ id: 'usr_hookownr', email: 'hook@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_hookpuls', name: 'Pulse', owner_id: 'usr_hookownr', instructions: '#', model: 'claude:sonnet', net: 91, channel_key: seal('k'.repeat(48)), wanted: 'stopped' }).execute()
await db.insertInto('channel').values({ id: 'ch_hookslak', agent_id: 'ag_hookpuls', kind: 'slack', status: 'connected', account: null, owner_address: '', open: false, allowed: 'C0ALERTS', secrets: '' }).execute()
signIn({ email: 'hook@example.com' })
runSet.watch()
await refresh()
const owner = { id: 'usr_hookownr', email: 'hook@example.com', role: 'owner' as const }
const told: { agentId: string; text: string }[] = []
inboxService.runDashboardWith(async (input) => { told.push(input); return '' })
changeRequestService.runDashboardWith(async () => '')

const app = Fastify()
answerErrors(app)
app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)
await app.register(inboxReceiver, { prefix: '/inbox' })

const alert = (id: string) => JSON.stringify({ specversion: '1.0', id, type: 'observability.alert.triggered', data: { alert_rule_name: 'Postgres CPU', state: 'firing', resource_name: 'pulse-db', value: 93 } })
const doSigned = ({ secret, body, at = Math.floor(Date.now() / 1000) }: { secret: string; body: string; at?: number }) =>
  `t=${at},v1=${createHmac('sha256', secret).update(`${at}.${body}`).digest('hex')}`
const post = ({ id, body, headers }: { id: string; body: string | Buffer; headers: Record<string, string> }) =>
  app.inject({ method: 'POST', url: `/inbox/${id}`, payload: body, headers: { 'content-type': 'application/cloudevents+json', ...headers } })
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))

test('a DigitalOcean alert with a valid signature reaches the agent\'s chat as a message with the raw payload', async () => {
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'DO Postgres alerts' })
  assert.match(hook.url, /\/inbox\/wh_[a-z0-9]{8}$/)
  const body = alert('evt-1')
  const res = await post({ id: hook.id, body, headers: { 'x-digitalocean-signature': doSigned({ secret: hook.secret, body }) } })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().repeat, false)
  await settle()
  assert.equal(told.length, 1)
  assert.match(told[0].text, /^\[Webhook wh_[a-z0-9]+ · hd_[a-z0-9]+\] "DO Postgres alerts" was just called\./)
  assert.ok(told[0].text.endsWith(body))
  assert.ok((await inboxService.webhooks({ actor: owner, agentId: 'ag_hookpuls' }))[0].lastAt)
})

test('a bad or stale signature is refused with 401 and nothing is delivered', async () => {
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'Bad' })
  const body = alert('evt-bad')
  const before = told.length
  assert.equal((await post({ id: hook.id, body, headers: { 'x-digitalocean-signature': doSigned({ secret: 'whsec_wrong', body }) } })).statusCode, 401)
  assert.equal((await post({ id: hook.id, body, headers: { 'x-digitalocean-signature': doSigned({ secret: hook.secret, body, at: Math.floor(Date.now() / 1000) - 600 }) } })).statusCode, 401)
  assert.equal((await post({ id: hook.id, body, headers: {} })).statusCode, 401)
  assert.equal((await post({ id: hook.id, body, headers: { authorization: 'Bearer nope' } })).statusCode, 401)
  assert.equal((await post({ id: 'wh_nothere1', body, headers: {} })).statusCode, 404)
  await settle()
  assert.equal(told.length, before)
})

test('the generic HMAC header and a bearer secret are accepted too', async () => {
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'Generic' })
  const body = '{"hello":"hmac"}'
  const hub = `sha256=${createHmac('sha256', hook.secret).update(body).digest('hex')}`
  assert.equal((await post({ id: hook.id, body, headers: { 'x-hub-signature-256': hub } })).statusCode, 200)
  assert.equal((await post({ id: hook.id, body: '{"hello":"bearer"}', headers: { authorization: `Bearer ${hook.secret}` } })).statusCode, 200)
})

test('a repeat of the same delivery is dropped', async () => {
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'Repeats' })
  const body = alert('evt-repeat')
  const first = await post({ id: hook.id, body, headers: { 'x-digitalocean-signature': doSigned({ secret: hook.secret, body }) } })
  const again = await post({ id: hook.id, body, headers: { 'x-digitalocean-signature': doSigned({ secret: hook.secret, body, at: Math.floor(Date.now() / 1000) + 1 }) } })
  assert.equal(first.json().repeat, false)
  assert.equal(again.statusCode, 200)
  assert.deepEqual(again.json(), { object: 'inbox_item', id: null, repeat: true })
  assert.equal((await db.selectFrom('inbox_item').select('id').where('source_id', '=', hook.id).execute()).length, 1)
})

test('a body over 256 KB is refused with 413', async () => {
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'Big' })
  const body = Buffer.alloc(256 * 1024 + 1, 'a')
  const res = await post({ id: hook.id, body, headers: { authorization: `Bearer ${hook.secret}` } })
  assert.equal(res.statusCode, 413)
})

test('a rotated secret stops the old one, and a deleted hook is gone', async () => {
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'Rotate' })
  const rotated = await inboxService.rotateSecret({ actor: owner, id: hook.id })
  assert.notEqual(rotated.secret, hook.secret)
  assert.equal((await post({ id: hook.id, body: '{"a":1}', headers: { authorization: `Bearer ${hook.secret}` } })).statusCode, 401)
  assert.equal((await post({ id: hook.id, body: '{"a":1}', headers: { authorization: `Bearer ${rotated.secret}` } })).statusCode, 200)
  await inboxService.remove({ actor: owner, id: hook.id })
  assert.equal((await post({ id: hook.id, body: '{"a":2}', headers: { authorization: `Bearer ${rotated.secret}` } })).statusCode, 404)
})

test('add_webhook waits for approval; approving creates the webhook, tells the agent its address, and Slack deliveries arrive through the due feed', async () => {
  const server = gatewayServer.create().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const token = agentToken({ id: 'ag_hookpuls', epoch: 0 })
  const client = new Client({ name: 'hermes', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/v1/mcp`), { requestInit: { headers: { authorization: `Agent ${token}` } } }))
  const slack = { platform: 'slack', chat_id: 'C0ALERTS', chat_type: 'group', chat_name: 'db-alerts' }
  const asked = await client.callTool({ name: 'add_webhook', arguments: { why: 'React to Postgres alerts.', name: 'DO Postgres alerts', origin: slack } })
  const text = (asked.content as { text: string }[])[0].text
  assert.match(text, /^Asked for approval \(chg_[a-z0-9]+\): Add a webhook named DO Postgres alerts\./)
  const id = /chg_[a-z0-9]+/.exec(text)?.[0] ?? ''
  const hooksBefore = await db.selectFrom('inbox_source').select('id').where('name', '=', 'DO Postgres alerts').where('origin', 'like', '%slack%').execute()
  assert.equal(hooksBefore.length, 0)

  const approved = await changeRequestService.approve({ actor: owner, id })
  assert.equal(approved.status, 'approved')
  const hookId = String(approved.input.webhookId)
  const hook = (await inboxService.webhooks({ actor: owner, agentId: 'ag_hookpuls' })).find((each) => each.id === hookId)
  assert.equal(hook?.place, '#db-alerts')

  const headers = { authorization: `Agent ${token}`, 'content-type': 'application/json' }
  const decision = (await (await fetch(`${base}/routines/due`, { headers })).json() as { data: { runId: string; text: string }[] }).data.find((run) => run.runId === id)
  assert.match(decision?.text ?? '', new RegExp(`Its address is \\S+/inbox/${hookId}\\.`))
  assert.doesNotMatch(decision?.text ?? '', new RegExp(hook?.secret ?? 'none'))

  const body = alert('evt-slack')
  assert.equal((await post({ id: hookId, body, headers: { 'x-digitalocean-signature': doSigned({ secret: hook?.secret ?? '', body }) } })).statusCode, 200)
  const due = (await (await fetch(`${base}/routines/due`, { headers })).json() as { data: { runId: string; text: string; origin: unknown }[] }).data.filter((run) => run.runId.startsWith('hd_'))
  assert.equal(due.length, 1)
  assert.deepEqual(due[0].origin, slack)
  assert.equal((await fetch(`${base}/routines/runs/${due[0].runId}`, { method: 'POST', headers, body: JSON.stringify({ picked: true }) })).status, 200)
  assert.equal((await (await fetch(`${base}/routines/due`, { headers })).json() as { data: { runId: string }[] }).data.filter((run) => run.runId.startsWith('hd_')).length, 0)
  const self = JSON.parse(((await client.callTool({ name: 'get_self', arguments: {} })).content as { text: string }[])[0].text)
  assert.ok(self.webhooks.some((each: { url: string }) => each.url.endsWith(hookId)))
  await client.close()
  server.close()
})

test('a routine moves to another place the agent posts, and can run with no end date', async () => {
  const slack = { platform: 'slack', chat_id: 'C0ALERTS', chat_type: 'group', chat_name: 'db-alerts' }
  const reply = await routineService.schedule({ agentId: 'ag_hookpuls', input: { name: 'Check slow queries', plan: 'Look at pg_stat_statements.', cron: '0 9 * * *', origin: slack } })
  const id = /rt_[a-z0-9]+/.exec(reply)?.[0] ?? ''
  const targets = await inboxService.targets({ actor: owner, agentId: 'ag_hookpuls' })
  assert.deepEqual(targets.map((each) => each.place), ['the OpenHut app', '#db-alerts'])
  const before = (await inboxService.routines({ actor: owner, agentId: 'ag_hookpuls' })).find((each) => each.id === id)
  assert.ok(before?.until)
  const moved = await inboxService.updateRoutine({ actor: owner, id, target: 'app', until: null })
  assert.equal(moved.place, 'the OpenHut app')
  assert.equal(moved.until, null)
  await assert.rejects(inboxService.updateRoutine({ actor: owner, id, target: 'nowhere' }), /Pick where it posts/)
  const webhook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'Moves', target: targets[1].id })
  assert.equal(webhook.place, '#db-alerts')
})

test('the owner sees the last payload a webhook got', async () => {
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'Last call' })
  assert.equal(hook.lastPayload, null)
  await post({ id: hook.id, body: '{"n":1}', headers: { authorization: `Bearer ${hook.secret}` } })
  await post({ id: hook.id, body: '{"n":2}', headers: { authorization: `Bearer ${hook.secret}` } })
  const listed = (await inboxService.webhooks({ actor: owner, agentId: 'ag_hookpuls' })).find((each) => each.id === hook.id)
  assert.equal(listed?.lastPayload, '{"n":2}')
})
