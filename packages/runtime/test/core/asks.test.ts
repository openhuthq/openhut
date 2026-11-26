import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { appWakes } from '../plugins/chat/app-wakes.ts'
import { gatewayServer } from '../../src/server/gateway/gateway-server.ts'
import { asks, asksPlugin } from '../../src/core/asks.ts'
import { defineAsk } from '../../src/core/plugin.ts'
import * as z from 'zod'
import { sql } from 'kysely'
import { db, migrate } from '../../src/server/platform/db.ts'
import { agentToken, seal } from '../../src/server/platform/secrets.ts'
import { runSet } from '../../src/server/agents/run-set.ts'
import { fakeAgentd, refresh, signIn } from '../server/agents/signed-in.ts'
import { connectionAuthorizationService } from '../../src/server/connections/connection-authorization-service.ts'
import { connectionService } from '../../src/server/connections/connection-service.ts'
import { mcp } from '../../src/server/integrations/mcp/mcp.ts'
import { permissions } from '../../src/server/permissions/permissions.ts'
import { activity } from '../../src/server/gateway/activity.ts'
import { agentService } from '../../src/server/agents/agent-service.ts'
import { wakes } from '../../src/core/wakes.ts'
import { HERE } from '../../src/server/team/home.ts'

const agentd = fakeAgentd()
await migrate()
await db.insertInto('person').values({ id: 'usr_chgowner', email: 'chg@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_chgagent', name: 'Dev', owner_id: 'usr_chgowner', instructions: '#', model: 'claude:sonnet', net: 73, channel_key: seal('k'.repeat(48)), wanted: 'stopped' }).execute()
await db.insertInto('channel').values({ id: 'ch_chgwhats', agent_id: 'ag_chgagent', kind: 'whatsapp', status: 'connected', account: null, owner_address: '15550002222', open: false, allowed: '', secrets: '' }).execute()

signIn({ email: 'chg@example.com' })
runSet.watch()
await refresh()
const owner = { id: 'usr_chgowner', email: 'chg@example.com', role: 'owner' as const }
const { told, deliver, settled } = appWakes()

const server = gatewayServer.create().listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const token = agentToken({ id: 'ag_chgagent', epoch: 0 })
const client = new Client({ name: 'hermes', version: '1' })
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/v1/mcp`), { requestInit: { headers: { authorization: `Agent ${token}` } } }))
const app = { platform: 'api_server', chat_id: 'openhut-chgsession' }
const whatsapp = { platform: 'whatsapp', chat_id: '15550002222@s.whatsapp.net', chat_type: 'dm' }
const textOf = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { text: string }[])[0].text
const idIn = (text: string) => /ask_[a-z0-9]+/.exec(text)?.[0] ?? ''

test.afterEach(async () => {
  const open = await db.selectFrom('ask').select('id').where('agent_id', '=', 'ag_chgagent').where('status', '=', 'open').execute()
  for (const { id } of open) await asks.decline({ actor: owner, id })
  await settled()
})

test('get_self shows the agent its name, instructions and channels', async () => {
  const self = JSON.parse(textOf(await client.callTool({ name: 'get_self', arguments: {} })))
  assert.equal(self.name, 'Dev')
  assert.deepEqual(self.channels.map((channel: { id: string }) => channel.id), ['ch_chgwhats'])
})

test('a rename waits for approval, the owner edits it, and the decision goes back to the chat it came from', async () => {
  const refused = await client.callTool({ name: 'update_self', arguments: { why: 'Clearer name.', name: 'Ops' } })
  assert.equal(refused.isError, true)
  const asked = textOf(await client.callTool({ name: 'update_self', arguments: { why: 'Clearer name.', name: 'Ops', origin: app } }))
  assert.match(asked, /^Asked for approval \(ask_[a-z0-9]+\): Rename to Ops\. Nothing has changed yet\./)
  const id = idIn(asked)
  assert.equal((await db.selectFrom('agent').select('name').where('id', '=', 'ag_chgagent').executeTakeFirstOrThrow()).name, 'Dev')
  assert.deepEqual(await asks.inChat({ agentId: 'ag_chgagent', since: new Date(Date.now() - 60_000) }), [id])

  const approved = await asks.approve({ actor: owner, id, answer: { name: 'Ops Bot' } })
  assert.equal(approved.status, 'done')
  assert.equal(approved.title, 'Rename to Ops Bot')
  assert.equal((await db.selectFrom('agent').select('name').where('id', '=', 'ag_chgagent').executeTakeFirstOrThrow()).name, 'Ops Bot')
  await settled()
  assert.deepEqual(told.map((each) => each.agentId), ['ag_chgagent'])
  assert.match(told[0].text, /^\[OpenHut asks:wk_[a-z0-9]+\] Your owner answered your ask:\n- Approved and done: Rename to Ops Bot\./)
  assert.equal((await asks.approve({ actor: owner, id, answer: { name: 'Other' } })).title, 'Rename to Ops Bot', 'approving an answered ask returns it as it is')
})

test('a denied request from WhatsApp reaches the agent through the plugin\'s wakes poll, once, and never through the app', async () => {
  const asked = textOf(await client.callTool({ name: 'update_channel', arguments: { why: 'Let the team in.', id: 'ch_chgwhats', open: true, origin: whatsapp } }))
  const id = idIn(asked)
  assert.match(asked, /Change who can message it on WhatsApp/)
  await asks.decline({ actor: owner, id, note: 'Not yet' })
  const heard = told.length
  deliver('ag_chgagent')
  await settled()
  assert.equal(told.length, heard, 'a WhatsApp wake is not the app\'s to deliver')
  assert.equal((await db.selectFrom('channel').select('open').where('id', '=', 'ch_chgwhats').executeTakeFirstOrThrow()).open, false)
  const headers = { authorization: `Agent ${token}`, 'content-type': 'application/json' }
  const due = await (await fetch(`${base}/wakes`, { headers })).json() as { data: { id: string; text: string; origin: unknown }[] }
  assert.equal(due.data.length, 1)
  assert.match(due.data[0].id, /^asks:wk_[a-z0-9]+$/)
  assert.match(due.data[0].text, /Not approved: Change who can message it on WhatsApp\. They said: "Not yet"/)
  assert.deepEqual(due.data[0].origin, whatsapp)
  assert.equal((await fetch(`${base}/wakes/${due.data[0].id}`, { method: 'POST', headers, body: JSON.stringify({ picked: true }) })).status, 200)
  assert.equal(((await (await fetch(`${base}/wakes`, { headers })).json()) as { data: unknown[] }).data.length, 0)
})

test('an agent can\'t ask about a channel that isn\'t its own, or add Slack', async () => {
  const other = await client.callTool({ name: 'remove_channel', arguments: { why: 'x', id: 'ch_notmine1', origin: app } })
  assert.equal(other.isError, true)
  assert.match(textOf(other), /You have no channel ch_notmine1/)
  const slack = await client.callTool({ name: 'add_channel', arguments: { why: 'x', kind: 'slack', ownerAddress: 'x', open: false, origin: app } })
  assert.equal(slack.isError, true)
})

test('an agent can ask for Discord with its bot token, and the token stays out of the summary', async () => {
  const token = 'fake-discord-bot-token-aaaa.bbbbbb.fake-discord-bot-token-cccc'
  const asked = await client.callTool({ name: 'add_channel', arguments: { why: 'The team lives on Discord', kind: 'discord', botToken: token, allowed: ['123456789012345678'], origin: app } })
  assert.notEqual(asked.isError, true)
  const row = await db.selectFrom('ask').select(['title', 'input']).where('kind', '=', 'add_channel').orderBy('created_at', 'desc').executeTakeFirstOrThrow()
  assert.equal(row.title, 'Add Discord')
  assert.doesNotMatch(row.title, /fake-discord/)
  const noChannels = await client.callTool({ name: 'add_channel', arguments: { why: 'x', kind: 'discord', botToken: token, origin: app } })
  assert.notEqual(noChannels.isError, true, 'the owner picks its channels in OpenHut')
})

test('a decision the agent never heard about is sent again by the chat plugin\'s next tick', async () => {
  const asked = textOf(await client.callTool({ name: 'update_self', arguments: { why: 'Shorter.', name: 'Op', origin: app } }))
  const id = idIn(asked)
  await asks.decline({ actor: owner, id })
  await settled()
  await db.updateTable('ask').set({ told: false }).where('id', '=', id).execute()
  const before = told.length
  deliver('ag_chgagent')
  await settled()
  assert.equal(told.length, before + 1)
  assert.match(told.at(-1)?.text ?? '', /^\[OpenHut asks:wk_[a-z0-9]+\] Your owner answered your ask:\n- Not approved/)
  assert.equal((await db.selectFrom('ask').select('told').where('id', '=', id).executeTakeFirstOrThrow()).told, true)
})

test('approving again after a crash is safe: a channel already removed counts as done, and the agent can\'t ask to add one it has', async () => {
  const twice = await client.callTool({ name: 'add_channel', arguments: { why: 'x', kind: 'whatsapp', ownerAddress: '+15550002222', open: false, origin: app } })
  assert.equal(twice.isError, true)
  assert.match(textOf(twice), /already have WhatsApp/)
  const asked = textOf(await client.callTool({ name: 'remove_channel', arguments: { why: 'Not used.', id: 'ch_chgwhats', origin: app } }))
  const id = idIn(asked)
  await db.deleteFrom('channel').where('id', '=', 'ch_chgwhats').execute()
  assert.equal((await asks.approve({ actor: owner, id })).status, 'done')
})

const DIGITALOCEAN = { why: 'To watch prod-db.', app: 'mcp', name: 'DigitalOcean', url: 'https://mcp.digitalocean.com/mcp', token: 'DigitalOcean token', guide: 'Make a read and write token.', link: 'https://cloud.digitalocean.com/account/api/tokens', permissions: { read: 'allow', update: 'ask', delete: 'deny' } }
const DO_TOOLS = [
  { name: 'db-cluster-get', description: 'Get a cluster', schema: {}, annotations: { readOnlyHint: true } },
  { name: 'db-cluster-resize', description: 'Resize a cluster', schema: {}, annotations: { readOnlyHint: false } },
  { name: 'db-cluster-delete', description: 'Delete a cluster', schema: {}, annotations: { destructiveHint: true } },
]

test('connect_app with a token: the owner pastes it, OpenHut connects and grants the asking agent with the permissions picked, and the agent never sees the token', async () => {
  const secret = 'dop_v1_fakeTokenThatMustStayHidden0123456789'
  const probes: unknown[] = []
  mock.method(mcp, 'probe', async (target: unknown) => { probes.push(target); return DO_TOOLS.length })
  mock.method(connectionService, 'specs', async () => DO_TOOLS)
  const asked = await client.callTool({ name: 'connect_app', arguments: { ...DIGITALOCEAN, origin: app } })
  assert.notEqual(asked.isError, true)
  const id = idIn(textOf(asked))
  assert.match(textOf(asked), /Connect DigitalOcean/)
  const open = await asks.get({ actor: owner, id })
  assert.deepEqual(Object.keys((open.form as { properties: object }).properties), ['connectionId', 'fields', 'permissions'])
  await assert.rejects(asks.approve({ actor: owner, id, answer: {} }), /Pick a connection or fill in its fields/)
  await assert.rejects(asks.approve({ actor: owner, id, answer: { fields: { token: 'has space' } } }), /no spaces/)
  const approved = await asks.approve({ actor: owner, id, answer: { fields: { token: ` ${secret} ` }, permissions: { read: 'allow', update: 'deny', delete: 'deny' } } })
  assert.equal(approved.status, 'done')
  assert.deepEqual(probes, [{ url: DIGITALOCEAN.url, headers: { Authorization: `Bearer ${secret}` } }])
  const connection = await db.selectFrom('connection').select(['id', 'kind', 'config']).where('name', '=', 'DigitalOcean').executeTakeFirstOrThrow()
  assert.equal(connection.kind, 'mcp')
  assert.doesNotMatch(connection.config, new RegExp(secret))
  assert.ok((await connectionService.reachable({ agent: { id: 'ag_chgagent', owner_id: 'usr_chgowner' } })).some((each) => each.id === connection.id))
  const states = await permissions.list({ agentId: 'ag_chgagent', connectionId: connection.id, tools: DO_TOOLS })
  assert.deepEqual(states.map((each) => [each.name, each.permission]), [['db-cluster-get', 'allow'], ['db-cluster-resize', 'deny'], ['db-cluster-delete', 'deny']])
  await settled()
  const row = await db.selectFrom('ask').select(['input', 'title', 'reply']).where('id', '=', id).executeTakeFirstOrThrow()
  for (const text of [row.input, row.title, row.reply ?? '', JSON.stringify(approved), ...told.map((each) => each.text)]) assert.doesNotMatch(text, new RegExp(secret))
  assert.match(told.at(-1)?.text ?? '', new RegExp(`Approved and done: Connect DigitalOcean\\. You can use DigitalOcean now \\(${connection.id}\\)`))
  mock.restoreAll()
})

test('connect_app with a connection that already exists grants it without a second step, and refuses one of another kind', async () => {
  await db.insertInto('connection').values([
    { id: 'cn_existpg1', kind: 'postgres', name: 'Prod DB', owner_id: 'usr_chgowner', config: seal('{}') },
    { id: 'cn_existln1', kind: 'linear', name: 'Linear', owner_id: 'usr_chgowner', config: seal('{}') },
  ]).execute()
  const id = idIn(textOf(await client.callTool({ name: 'connect_app', arguments: { why: 'To watch slow queries.', app: 'postgres', origin: app } })))
  await assert.rejects(asks.approve({ actor: owner, id, answer: { connectionId: 'cn_existln1' } }), /Linear isn't a Postgres connection/)
  assert.equal((await asks.approve({ actor: owner, id, answer: { connectionId: 'cn_existpg1', permissions: { read: 'allow' } } })).status, 'done')
  assert.ok((await agentService.listGrants({ agentId: 'ag_chgagent' })).some((grant) => grant.connectionId === 'cn_existpg1'))
})

test('connect_app by sign-in: the callback approves the ask for the owner, so the agent gets the new connection with the permissions picked before the sign-in', async () => {
  mock.method(mcp, 'beginSignIn', async () => ({ authorizationUrl: 'https://tracker.example.com/authorize', flow: {} }))
  mock.method(mcp, 'finishSignIn', async () => ({ tokens: { access_token: 'at', token_type: 'Bearer' } }))
  mock.method(connectionService, 'listTools', async () => [])
  mock.method(connectionService, 'specs', async () => DO_TOOLS)
  const id = idIn(textOf(await client.callTool({ name: 'connect_app', arguments: { why: 'To file issues.', app: 'mcp', name: 'Tracker', url: 'https://tracker.example.com/mcp', origin: app } })))
  await assert.rejects(connectionAuthorizationService.create({ actor: owner, kind: 'mcp', url: 'https://tracker.example.com/mcp', askId: idIn(textOf(await client.callTool({ name: 'update_self', arguments: { why: 'x', name: 'Not a connect', origin: app } }))) }), /isn't for connecting an app/)
  const started = await connectionAuthorizationService.create({ actor: owner, kind: 'mcp', name: 'Tracker', url: 'https://tracker.example.com/mcp', askId: id, permissions: { read: 'allow', update: 'deny' } })
  assert.equal((await asks.get({ actor: owner, id })).status, 'open')
  const done = await connectionAuthorizationService.finish({ state: started.id, code: 'good' })
  assert.equal(done.error, undefined)
  assert.equal((await asks.get({ actor: owner, id })).status, 'done')
  assert.ok((await agentService.listGrants({ agentId: 'ag_chgagent' })).some((grant) => grant.connectionId === done.connectionId))
  const states = await permissions.list({ agentId: 'ag_chgagent', connectionId: done.connectionId ?? '', tools: DO_TOOLS })
  assert.deepEqual(states.map((each) => each.permission), ['allow', 'deny', 'deny'])
  assert.equal((await connectionAuthorizationService.get({ actor: owner, id: started.id })).status, 'done')
  mock.restoreAll()
})

test('connect_app takes a url, a name or a token only for app mcp, and app mcp needs its url', async () => {
  const wrong = await client.callTool({ name: 'connect_app', arguments: { why: 'x', app: 'linear', url: 'https://mcp.linear.app/mcp', origin: app } })
  assert.equal(wrong.isError, true)
  assert.match(textOf(wrong), /Only app mcp takes a url/)
  const missing = await client.callTool({ name: 'connect_app', arguments: { why: 'x', app: 'mcp', name: 'Thing', origin: app } })
  assert.equal(missing.isError, true)
  assert.match(textOf(missing), /Send the MCP server's url/)
  assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).filter((name) => /connect|propose|request_connection/.test(name)), ['connect_app'])
})

test('asks list newest first, and ones made at the same moment keep one order', async () => {
  await db.updateTable('ask').set({ created_at: new Date('2026-11-26T10:00:00Z') }).where('agent_id', '=', 'ag_chgagent').execute()
  const ids = (await asks.list({ agentId: 'ag_chgagent' })).map((each) => each.id)
  assert.ok(ids.length > 1)
  assert.deepEqual(ids, [...ids].sort().reverse())
})

test('asks answered in one chat reach the agent as one wake, once nothing in that chat is open', async () => {
  const chat = { platform: 'api_server', chat_id: 'openhut-batch' }
  const first = idIn(await asks.create({ agentId: 'ag_chgagent', kind: 'add_webhook', input: { name: 'Batch one' }, why: 'x', origin: chat }))
  const second = idIn(await asks.create({ agentId: 'ag_chgagent', kind: 'add_webhook', input: { name: 'Batch two' }, why: 'x', origin: chat }))
  const before = told.length
  await asks.decline({ actor: owner, id: first, note: 'Later' })
  await settled()
  assert.equal(told.length, before, 'one ask in that chat is still open')
  await asks.approve({ actor: owner, id: second })
  await settled()
  assert.equal(told.length, before + 1)
  const [line] = told.slice(-1)
  assert.match(line.text, /^\[OpenHut asks:wk_[a-z0-9]+\] Your owner answered 2 of your asks:\n- Not approved: Add a webhook named Batch one\. They said: "Later".*\n- Approved and done: Add a webhook named Batch two\. Its address is /)
  deliver('ag_chgagent')
  await settled()
  assert.equal(told.length, before + 1, 'told once')
})

test('an answer waits at most 30 seconds for the chat\'s other asks, then goes alone and says what is still open', async () => {
  const chat = { platform: 'api_server', chat_id: 'openhut-slow' }
  const first = idIn(await asks.create({ agentId: 'ag_chgagent', kind: 'add_webhook', input: { name: 'Slow one' }, why: 'x', origin: chat }))
  idIn(await asks.create({ agentId: 'ag_chgagent', kind: 'add_webhook', input: { name: 'Slow two' }, why: 'x', origin: chat }))
  await asks.decline({ actor: owner, id: first })
  assert.deepEqual((await wakes.due({ agentId: 'ag_chgagent' })).filter((wake) => wake.origin.chat_id === 'openhut-slow'), [])
  await db.updateTable('ask').set({ answered_at: new Date(Date.now() - 31_000) }).where('id', '=', first).execute()
  const [wake] = (await wakes.due({ agentId: 'ag_chgagent' })).filter((each) => each.origin.chat_id === 'openhut-slow')
  assert.match(wake.text, /Your owner answered your ask:\n- Not approved: Add a webhook named Slow one\..*\nStill waiting for: Add a webhook named Slow two\./s)
})

test('a wake waits for the restart its answer needs, and the restart waits for the agent to go quiet', async () => {
  const id = idIn(await asks.create({ agentId: 'ag_chgagent', kind: 'update_self', input: { instructions: '# Quiet\nNew.' }, why: 'x', origin: app }))
  activity.started('ag_chgagent')
  const applies = agentd.applies.length
  const before = told.length
  await asks.approve({ actor: owner, id })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.equal(agentService.restartPending('ag_chgagent'), true)
  await agentService.sync({ computer: HERE })
  assert.equal(agentd.applies.length, applies, 'no restart while a call is open')
  assert.deepEqual(await wakes.due({ agentId: 'ag_chgagent' }), [], 'no wake before the restart')
  const ended = Date.now()
  activity.ended('ag_chgagent')
  await settled()
  const restart = agentd.applies.slice(applies).find((each) => each.id === 'ag_chgagent')
  assert.ok(restart && restart.at >= ended + 9_000, 'restarted once quiet for 10 seconds')
  assert.equal(told.length, before + 1)
  assert.match(told.at(-1)?.text ?? '', /Approved and done: Change its instructions\. You have already restarted with it\./)
})

test('a grant made in the app waits for the agent to go quiet before it restarts it', async () => {
  const connection = { id: 'cn_quietdb1' }
  await db.insertInto('connection').values({ id: connection.id, kind: 'postgres', name: 'Quiet DB', owner_id: 'usr_chgowner', config: seal('{}') }).execute()
  activity.started('ag_chgagent')
  const applies = agentd.applies.length
  await agentService.createGrant({ actor: owner, agentId: 'ag_chgagent', connectionId: connection.id })
  await new Promise((resolve) => setTimeout(resolve, 1500))
  assert.equal(agentd.applies.length, applies)
  activity.ended('ag_chgagent')
  await settled()
  assert.ok(agentd.applies.length > applies)
})

test('asking for the same thing twice while it is open gives back the first ask', async () => {
  const first = idIn(textOf(await client.callTool({ name: 'update_self', arguments: { why: 'Same.', name: 'Twin', origin: app } })))
  const again = idIn(textOf(await client.callTool({ name: 'update_self', arguments: { why: 'Same again.', name: 'Twin', origin: app } })))
  assert.equal(again, first)
  await asks.decline({ actor: owner, id: first })
})

test('an ask whose kind no plugin defines any more expires with a standard note', async () => {
  await db.insertInto('ask').values({ id: 'ask_gonekind', agent_id: 'ag_chgagent', kind: 'gone_kind', input: '{}', title: 'Do a gone thing', why: 'x', origin: JSON.stringify(app) }).execute()
  const gone = (await asks.list({ agentId: 'ag_chgagent' })).find((each) => each.id === 'ask_gonekind')
  assert.equal(gone?.status, 'expired')
  const row = await db.selectFrom('ask').select('reply').where('id', '=', 'ask_gonekind').executeTakeFirstOrThrow()
  assert.match(row.reply ?? '', /Do a gone thing didn't happen: OpenHut can't do this kind of ask any more\./)
})

test('two plugins can\'t define one ask kind, and a kind with a tool becomes an MCP tool with why', async () => {
  const kind = defineAsk({ input: z.object({ x: z.string() }), tool: 'Do x.', title: () => 'X', run: async () => undefined })
  assert.throws(() => asksPlugin([{ name: 'a', asks: { do_x: kind } }, { name: 'b', asks: { do_x: kind } }]), /Two plugins define the ask do_x/)
  const plugin = asksPlugin([{ name: 'a', asks: { do_x: kind } }])
  assert.deepEqual(Object.keys(plugin.tools ?? {}), ['do_x'])
  assert.deepEqual(Object.keys(plugin.tools?.do_x.input ?? {}), ['why', 'x'])
})

test('change requests from before the upgrade become asks with the same ids, and a pending one can still be approved', async () => {
  await db.schema.createTable('change_request').ifNotExists()
    .addColumn('id', 'text', (col) => col.primaryKey()).addColumn('agent_id', 'text').addColumn('action', 'text').addColumn('input', 'text').addColumn('summary', 'text')
    .addColumn('why', 'text').addColumn('origin', 'text').addColumn('status', 'text').addColumn('note', 'text').addColumn('told', 'boolean')
    .addColumn('created_at', 'timestamptz').addColumn('decided_at', 'timestamptz').addColumn('expires_at', 'timestamptz').addColumn('result', 'text').execute()
  const old = { agent_id: 'ag_chgagent', why: 'Old.', origin: JSON.stringify(app), created_at: new Date(), expires_at: null, result: null }
  await sql`insert into change_request (id, agent_id, action, input, summary, why, origin, status, note, told, created_at, decided_at, expires_at, result) values
    ('chg_oldpend1', ${old.agent_id}, 'update_self', '{"name":"Legacy"}', 'Rename to Legacy', ${old.why}, ${old.origin}, 'pending', null, false, now(), null, null, null),
    ('chg_olddeny1', ${old.agent_id}, 'update_self', '{"name":"Nope"}', 'Rename to Nope', ${old.why}, ${old.origin}, 'denied', 'No', true, now(), now(), null, null)`.execute(db)
  await migrate()
  await migrate()
  const rows = await db.selectFrom('ask').select(['id', 'kind', 'status', 'title', 'note']).where('id', 'like', 'chg_old%').orderBy('id').execute()
  assert.deepEqual(rows, [
    { id: 'chg_olddeny1', kind: 'update_self', status: 'declined', title: 'Rename to Nope', note: 'No' },
    { id: 'chg_oldpend1', kind: 'update_self', status: 'open', title: 'Rename to Legacy', note: null },
  ])
  assert.equal((await asks.approve({ actor: owner, id: 'chg_oldpend1' })).status, 'done')
  assert.equal((await db.selectFrom('agent').select('name').where('id', '=', 'ag_chgagent').executeTakeFirstOrThrow()).name, 'Legacy')
})

test.after(() => { void client.close(); server.close() })
