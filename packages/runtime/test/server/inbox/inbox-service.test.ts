import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { gatewayServer } from '../../../src/server/gateway/gateway-server.ts'
import { asks } from '../../../src/core/asks.ts'
import { inboxReceiver } from '../../../src/server/inbox/inbox-controller.ts'
import { deliveryIdOf, inboxService, render } from '../../../src/server/inbox/inbox-service.ts'
import { routineService } from '../../../src/server/inbox/routines.ts'
import { channelService } from '../../../src/server/channels/channel-service.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { agentToken, seal } from '../../../src/server/platform/secrets.ts'
import { runSet } from '../../../src/server/agents/run-set.ts'
import { agentService } from '../../../src/server/agents/agent-service.ts'
import { fakeAgentd, refresh, signIn } from '../agents/signed-in.ts'
import { appWakes } from '../../plugins/chat/app-wakes.ts'

fakeAgentd()
await migrate()
await db.insertInto('person').values({ id: 'usr_hookownr', email: 'hook@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_hookpuls', name: 'Pulse', owner_id: 'usr_hookownr', instructions: '#', model: 'claude:sonnet', net: 91, channel_key: seal('k'.repeat(48)), wanted: 'stopped' }).execute()
await db.insertInto('channel').values({ id: 'ch_hookslak', agent_id: 'ag_hookpuls', kind: 'slack', status: 'connected', account: null, owner_address: '', open: false, allowed: 'C0ALERTS', secrets: '' }).execute()
signIn({ email: 'hook@example.com' })
runSet.watch()
await refresh()
const owner = { id: 'usr_hookownr', email: 'hook@example.com', role: 'owner' as const }
const { told, settled } = appWakes()

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
const settle = settled

test('a DigitalOcean alert with a valid signature reaches the agent\'s chat as a message with the raw payload', async () => {
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'DO Postgres alerts' })
  assert.match(hook.url, /\/inbox\/wh_[a-z0-9]{8}$/)
  const body = alert('evt-1')
  const res = await post({ id: hook.id, body, headers: { 'x-digitalocean-signature': doSigned({ secret: hook.secret, body }) } })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().repeat, false)
  await settle()
  assert.equal(told.length, 1)
  assert.match(told[0].text, /^\[OpenHut inbox:hd_[a-z0-9]+\] Webhook wh_[a-z0-9]+ "DO Postgres alerts" was just called\./)
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

test('add_webhook waits for approval; approving creates the webhook and tells the agent its address, and its calls run on the server, never through the plugin\'s wakes poll', async () => {
  const server = gatewayServer.create().listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const token = agentToken({ id: 'ag_hookpuls', epoch: 0 })
  const client = new Client({ name: 'hermes', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/v1/mcp`), { requestInit: { headers: { authorization: `Agent ${token}` } } }))
  const listed = new Map((await client.listTools()).tools.map((tool) => [tool.name, tool.inputSchema]))
  assert.deepEqual(Object.keys(listed.get('set_webhook_threads')?.properties ?? {}).sort(), ['groupBy', 'id', 'labelBy', 'threads', 'titleBy'])
  assert.deepEqual((listed.get('set_webhook_threads')?.properties?.threads as { enum?: string[] }).enum, ['group', 'each'])
  assert.deepEqual((listed.get('add_webhook')?.properties?.threads as { enum?: string[] }).enum, ['group', 'each'])
  const slack = { platform: 'slack', chat_id: 'C0ALERTS', chat_type: 'group', chat_name: 'db-alerts' }
  const asked = await client.callTool({ name: 'add_webhook', arguments: { description: 'React to Postgres alerts.', name: 'DO Postgres alerts', threads: 'each', origin: slack } })
  const text = (asked.content as { text: string }[])[0].text
  assert.match(text, /^Asked for approval \(ask_[a-z0-9]+\): Add a webhook named DO Postgres alerts\./)
  const id = /ask_[a-z0-9]+/.exec(text)?.[0] ?? ''
  const known = new Set((await inboxService.webhooks({ actor: owner, agentId: 'ag_hookpuls' })).map((each) => each.id))
  const approved = await asks.approve({ actor: owner, id })
  assert.equal(approved.status, 'done')
  const hook = (await inboxService.webhooks({ actor: owner, agentId: 'ag_hookpuls' })).find((each) => !known.has(each.id))
  assert.equal(hook?.threads, 'each')
  const hookId = hook?.id ?? ''

  const headers = { authorization: `Agent ${token}`, 'content-type': 'application/json' }
  const decision = (await (await fetch(`${base}/wakes`, { headers })).json() as { data: { id: string; text: string }[] }).data.find((wake) => wake.id.startsWith('asks:wk_'))
  assert.match(decision?.text ?? '', new RegExp(`Its address is \\S+/inbox/${hookId}\\.`))
  assert.doesNotMatch(decision?.text ?? '', new RegExp(hook?.secret ?? 'none'))

  const body = alert('evt-slack')
  assert.equal((await post({ id: hookId, body, headers: { 'x-digitalocean-signature': doSigned({ secret: hook?.secret ?? '', body }) } })).statusCode, 200)
  assert.equal((await (await fetch(`${base}/wakes`, { headers })).json() as { data: { id: string }[] }).data.filter((wake) => wake.id.startsWith('inbox:hd_')).length, 0)
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
})

test('the owner sees the last payload a webhook got', async () => {
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'Last call' })
  assert.equal(hook.lastPayload, null)
  await post({ id: hook.id, body: '{"n":1}', headers: { authorization: `Bearer ${hook.secret}` } })
  await post({ id: hook.id, body: '{"n":2}', headers: { authorization: `Bearer ${hook.secret}` } })
  const listed = (await inboxService.webhooks({ actor: owner, agentId: 'ag_hookpuls' })).find((each) => each.id === hook.id)
  assert.equal(listed?.lastPayload, '{"n":2}')
})

test('a member who can chat with a whole-team agent can\'t touch its webhooks or routines, or approve add_webhook', async () => {
  await db.insertInto('person').values({ id: 'usr_hookmmbr', email: 'member@example.com', role: 'member', removed_at: null }).execute()
  const member = { id: 'usr_hookmmbr', email: 'member@example.com', role: 'member' as const }
  await agentService.update({ actor: owner, id: 'ag_hookpuls', patch: { shared: true } })
  assert.equal((await agentService.requireUse({ actor: member, id: 'ag_hookpuls' })).id, 'ag_hookpuls')
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'Owner only' })
  const routine = /rt_[a-z0-9]+/.exec(await routineService.schedule({ agentId: 'ag_hookpuls', input: { name: 'Nightly', plan: 'x', cron: '0 3 * * *', origin: { platform: 'slack', chat_id: 'C0ALERTS', chat_type: 'group', chat_name: 'db-alerts' } } }))?.[0] ?? ''
  await db.insertInto('ask').values({ id: 'chg_hookmmbr', agent_id: 'ag_hookpuls', kind: 'add_webhook', input: JSON.stringify({ name: 'Sneaky' }), title: 'Add a webhook named Sneaky', why: 'x', origin: JSON.stringify({ platform: 'slack', chat_id: 'C0ALERTS' }), expires_at: new Date(Date.now() + 60_000) }).execute()
  for (const attempt of [
    inboxService.webhooks({ actor: member, agentId: 'ag_hookpuls' }),
    inboxService.createSource({ actor: member, agentId: 'ag_hookpuls', name: 'Mine' }),
    inboxService.updateWebhook({ actor: member, id: hook.id, name: 'Renamed' }),
    inboxService.rotateSecret({ actor: member, id: hook.id }),
    inboxService.remove({ actor: member, id: hook.id }),
    inboxService.targets({ actor: member, agentId: 'ag_hookpuls' }),
    inboxService.updateRoutine({ actor: member, id: routine, target: 'app' }),
    inboxService.updateRoutine({ actor: member, id: routine, until: null }),
    inboxService.stopRoutine({ actor: member, id: routine }),
    asks.approve({ actor: member, id: 'chg_hookmmbr' }),
  ]) await assert.rejects(attempt, { status: 403 })
  assert.equal((await db.selectFrom('inbox_source').select('id').where('name', 'in', ['Mine', 'Sneaky', 'Renamed']).execute()).length, 0)
  assert.equal((await asks.approve({ actor: owner, id: 'chg_hookmmbr' })).status, 'done')
})

test('a webhook\'s channel is the app unless set to a place the agent posts in', async () => {
  const humans = { platform: 'discord', chat_id: '777', chat_name: '#agents-humans' }
  const places = mock.method(channelService, 'places', async () => [humans])
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'Home' })
  assert.equal(hook.channel, 'app')
  assert.deepEqual((await inboxService.updateWebhook({ actor: owner, id: hook.id, channel: humans })).channel, humans)
  await assert.rejects(inboxService.updateWebhook({ actor: owner, id: hook.id, channel: { ...humans, chat_id: '1' } }), /Pick a channel from the list/)
  assert.equal((await inboxService.updateWebhook({ actor: owner, id: hook.id, channel: 'app' })).channel, 'app')
  places.mock.restore()
})

const doAlert = ({ id, state, value, time }: { id: string; state: string; value: number; time: string }) => JSON.stringify({ id, subject: 'pulse-db', time, data: { alert_rule_name: 'CPU high', resource_name: 'pulse-db', state, value } })
const doPost = ({ hook, body, headers = {} }: { hook: { id: string; secret: string }; body: string; headers?: Record<string, string> }) =>
  post({ id: hook.id, body, headers: { 'x-digitalocean-signature': doSigned({ secret: hook.secret, body }), ...headers } })

test('a template fills its holes from the payload, rounds numbers to one decimal, and is unset when nothing resolves', () => {
  const payload = JSON.parse(doAlert({ id: 'e1', state: 'STATE_TRIGGERED', value: 93.456, time: 't' }))
  assert.equal(render({ template: '{subject}/{data.alert_rule_name}', payload }), 'pulse-db/CPU high')
  assert.equal(render({ template: '{data.state} · {data.value}%', payload }), 'STATE_TRIGGERED · 93.5%')
  assert.equal(render({ template: '{nope} · {data.missing}', payload }), undefined)
  assert.equal(render({ template: null, payload }), undefined)
  assert.equal(render({ template: '{a}', payload: 'not json' }), undefined)
})

test('the delivery id comes from the sender\'s header, else the payload\'s top-level id', () => {
  assert.equal(deliveryIdOf({ headers: { 'x-github-delivery': 'g1' }, payload: { id: 'p1' } }), 'g1')
  assert.equal(deliveryIdOf({ headers: { 'idempotency-key': 'k1' }, payload: {} }), 'k1')
  assert.equal(deliveryIdOf({ headers: { 'webhook-id': 'w1' }, payload: {} }), 'w1')
  assert.equal(deliveryIdOf({ headers: {}, payload: { id: 'p1' } }), 'p1')
  assert.equal(deliveryIdOf({ headers: {}, payload: { id: 7 } }), undefined)
})

test('in group mode an alert and its recovery share a thread; a resend with the same id is skipped; each call gets a labelled message from the webhook', async () => {
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'DO alerts' })
  assert.equal(hook.threads, 'group')
  const first = told.length
  assert.equal((await doPost({ hook, body: doAlert({ id: 'g-1', state: 'STATE_TRIGGERED', value: 93.4, time: '2026-11-26T10:00:00Z' }) })).json().repeat, false)
  await settle()
  assert.match(told[first].text, /First call set_webhook_threads for wh_/)
  assert.match(await inboxService.setThreads({ agentId: 'ag_hookpuls', id: hook.id, groupBy: '{subject}/{data.alert_rule_name}', titleBy: '{data.alert_rule_name} · {data.resource_name}', labelBy: '{data.state} · {data.value}%' }), /group "pulse-db\/CPU high", thread title "CPU high · pulse-db"/)
  assert.equal((await doPost({ hook, body: doAlert({ id: 'g-2', state: 'STATE_TRIGGERED', value: 95, time: '2026-11-26T10:05:00Z' }) })).json().repeat, false)
  assert.equal((await doPost({ hook, body: doAlert({ id: 'g-3', state: 'STATE_RECOVERED', value: 40.25, time: '2026-11-26T10:20:00Z' }) })).json().repeat, false)
  assert.equal((await doPost({ hook, body: doAlert({ id: 'g-3', state: 'STATE_RECOVERED', value: 40.25, time: '2026-11-26T10:21:00Z' }) })).json().repeat, true)
  await settle()
  const [, triggered, recovered] = told.slice(first)
  assert.equal(told.length - first, 3)
  assert.doesNotMatch(triggered.text, /set_webhook_threads/)
  assert.equal(triggered.threadId, recovered.threadId)
  assert.notEqual(told[first].threadId, triggered.threadId)
  assert.deepEqual({ author: recovered.metadata?.author, call: recovered.metadata?.call }, { author: 'DO alerts', call: { webhookId: hook.id, label: 'STATE_RECOVERED · 40.3%' } })
  const thread = await db.selectFrom('chat_thread').select('title').where('id', '=', triggered.threadId ?? '').executeTakeFirstOrThrow()
  assert.equal(thread.title, 'CPU high · pulse-db')
})

test('X-Group-Key picks the thread, and each mode starts a new thread per call', async () => {
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'Keys' })
  const first = told.length
  await doPost({ hook, body: '{"n":1}', headers: { 'x-group-key': 'order-9' } })
  await doPost({ hook, body: '{"n":2}', headers: { 'x-group-key': 'order-9' } })
  await settle()
  assert.equal(told[first].threadId, told[first + 1].threadId)
  assert.match(await inboxService.setThreads({ agentId: 'ag_hookpuls', id: hook.id, threads: 'each' }), /Each call starts a new thread/)
  assert.equal((await inboxService.webhooks({ actor: owner, agentId: 'ag_hookpuls' })).find((each) => each.id === hook.id)?.threads, 'each')
  assert.equal((await inboxService.updateWebhook({ actor: owner, id: hook.id, threads: 'each' })).threads, 'each')
  await doPost({ hook, body: '{"n":3}', headers: { 'x-group-key': 'order-9' } })
  await doPost({ hook, body: '{"n":4}', headers: { 'x-group-key': 'order-9' } })
  await settle()
  assert.equal(told.length - first, 4)
  assert.notEqual(told[first + 2].threadId, told[first + 3].threadId)
  assert.notEqual(told[first + 2].threadId, told[first].threadId)
})

test('a webhook that runs in Discord starts one Discord thread per group: the first call starts it, named by titleBy, and later calls reuse it', async () => {
  const humans = { platform: 'discord', chat_id: '777', chat_name: '#agents-humans' }
  const places = mock.method(channelService, 'places', async () => [humans])
  let started = 900
  const sent = mock.method(channelService, 'send', async () => ({ url: `https://discord.com/channels/1/${started}`, messageId: '9', threadId: String(started++) }))
  const hook = await inboxService.createSource({ actor: owner, agentId: 'ag_hookpuls', name: 'DO in Discord', channel: humans })
  await inboxService.setThreads({ agentId: 'ag_hookpuls', id: hook.id, groupBy: '{subject}/{data.alert_rule_name}', titleBy: '{data.alert_rule_name} · {data.resource_name}' })
  const first = told.length
  const one = (await doPost({ hook, body: doAlert({ id: 'd-1', state: 'STATE_TRIGGERED', value: 91, time: '2026-11-26T11:00:00Z' }) })).json().id
  await settle()
  const threadId = told[first].threadId ?? ''
  await inboxService.answered({ agentId: 'ag_hookpuls', id: one, threadId, said: 'CPU is high.' })
  const two = (await doPost({ hook, body: doAlert({ id: 'd-2', state: 'STATE_RECOVERED', value: 30, time: '2026-11-26T11:20:00Z' }) })).json().id
  await settle()
  assert.equal(told[first + 1].threadId, threadId)
  await inboxService.answered({ agentId: 'ag_hookpuls', id: two, threadId, said: 'Recovered.' })
  assert.deepEqual(sent.mock.calls.map((call) => call.arguments[0]), [{ agentId: 'ag_hookpuls', place: humans, text: 'CPU is high.', startThread: 'CPU high · pulse-db' }])
  assert.equal((await db.selectFrom('chat_thread').select('continue_url').where('id', '=', threadId).executeTakeFirstOrThrow()).continue_url, 'https://discord.com/channels/1/900')
  await inboxService.updateWebhook({ actor: owner, id: hook.id, threads: 'each' })
  const three = (await doPost({ hook, body: doAlert({ id: 'd-3', state: 'STATE_TRIGGERED', value: 92, time: '2026-11-26T12:00:00Z' }) })).json().id
  await settle()
  assert.notEqual(told[first + 2].threadId, threadId)
  await inboxService.answered({ agentId: 'ag_hookpuls', id: three, threadId: told[first + 2].threadId ?? '', said: 'High again.' })
  assert.equal(sent.mock.calls.length, 2)
  sent.mock.restore()
  places.mock.restore()
})
