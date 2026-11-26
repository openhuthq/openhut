import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { gatewayServer } from '../../../src/server/gateway/gateway-server.ts'
import { changeRequestService } from '../../../src/server/agents/change-request-service.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { agentToken, seal } from '../../../src/server/platform/secrets.ts'
import { runSet } from '../../../src/server/agents/run-set.ts'
import { fakeAgentd, refresh, signIn } from './signed-in.ts'
import { connectionService } from '../../../src/server/connections/connection-service.ts'
import { mcp } from '../../../src/server/integrations/mcp/mcp.ts'
import { permissions } from '../../../src/server/permissions/permissions.ts'

fakeAgentd()
await migrate()
await db.insertInto('person').values({ id: 'usr_chgowner', email: 'chg@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_chgagent', name: 'Dev', owner_id: 'usr_chgowner', instructions: '#', model: 'claude:sonnet', net: 73, channel_key: seal('k'.repeat(48)), wanted: 'stopped' }).execute()
await db.insertInto('channel').values({ id: 'ch_chgwhats', agent_id: 'ag_chgagent', kind: 'whatsapp', status: 'connected', account: null, owner_address: '15550002222', open: false, allowed: '', secrets: '' }).execute()

signIn({ email: 'chg@example.com' })
runSet.watch()
await refresh()
const owner = { id: 'usr_chgowner', email: 'chg@example.com', role: 'owner' as const }
const told: { agentId: string; text: string }[] = []
changeRequestService.runDashboardWith(async (input) => { told.push(input); return '' })

const server = gatewayServer.create().listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const token = agentToken({ id: 'ag_chgagent', epoch: 0 })
const client = new Client({ name: 'hermes', version: '1' })
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/v1/mcp`), { requestInit: { headers: { authorization: `Agent ${token}` } } }))
const app = { platform: 'api_server', chat_id: 'openhut-chgsession' }
const whatsapp = { platform: 'whatsapp', chat_id: '15550002222@s.whatsapp.net', chat_type: 'dm' }
const textOf = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { text: string }[])[0].text
const idIn = (text: string) => /chg_[a-z0-9]+/.exec(text)?.[0] ?? ''

test('get_self shows the agent its name, instructions and channels', async () => {
  const self = JSON.parse(textOf(await client.callTool({ name: 'get_self', arguments: {} })))
  assert.equal(self.name, 'Dev')
  assert.deepEqual(self.channels.map((channel: { id: string }) => channel.id), ['ch_chgwhats'])
})

test('a rename waits for approval, the owner edits it, and the decision goes back to the chat it came from', async () => {
  const refused = await client.callTool({ name: 'update_self', arguments: { why: 'Clearer name.', name: 'Ops' } })
  assert.equal(refused.isError, true)
  const asked = textOf(await client.callTool({ name: 'update_self', arguments: { why: 'Clearer name.', name: 'Ops', origin: app } }))
  assert.match(asked, /^Asked for approval \(chg_[a-z0-9]+\): Rename to Ops\. Nothing has changed yet\./)
  const id = idIn(asked)
  assert.equal((await db.selectFrom('agent').select('name').where('id', '=', 'ag_chgagent').executeTakeFirstOrThrow()).name, 'Dev')
  assert.deepEqual(await changeRequestService.inChat({ agentId: 'ag_chgagent', since: new Date(Date.now() - 60_000) }), [id])

  const approved = await changeRequestService.approve({ actor: owner, id, input: { name: 'Ops Bot' } })
  assert.equal(approved.status, 'approved')
  assert.equal(approved.summary, 'Rename to Ops Bot')
  assert.equal((await db.selectFrom('agent').select('name').where('id', '=', 'ag_chgagent').executeTakeFirstOrThrow()).name, 'Ops Bot')
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.deepEqual(told.map((each) => each.agentId), ['ag_chgagent'])
  assert.match(told[0].text, new RegExp(`^\\[OpenHut ${id}\\] Approved and done: Rename to Ops Bot\\.`))
  await assert.rejects(changeRequestService.approve({ actor: owner, id }), /already approved/)
})

test('a denied request from WhatsApp reaches the agent through its due feed, once', async () => {
  const asked = textOf(await client.callTool({ name: 'update_channel', arguments: { why: 'Let the team in.', id: 'ch_chgwhats', open: true, origin: whatsapp } }))
  const id = idIn(asked)
  assert.match(asked, /Change who can message it on WhatsApp/)
  await changeRequestService.deny({ actor: owner, id, note: 'Not yet' })
  assert.equal((await db.selectFrom('channel').select('open').where('id', '=', 'ch_chgwhats').executeTakeFirstOrThrow()).open, false)
  const headers = { authorization: `Agent ${token}`, 'content-type': 'application/json' }
  const due = await (await fetch(`${base}/routines/due`, { headers })).json() as { data: { runId: string; text: string; origin: unknown }[] }
  assert.deepEqual(due.data.map((run) => run.runId), [id])
  assert.match(due.data[0].text, /Not approved: Change who can message it on WhatsApp\. They said: "Not yet"/)
  assert.deepEqual(due.data[0].origin, whatsapp)
  assert.equal((await fetch(`${base}/routines/runs/${id}`, { method: 'POST', headers, body: JSON.stringify({ picked: true }) })).status, 200)
  assert.equal(((await (await fetch(`${base}/routines/due`, { headers })).json()) as { data: unknown[] }).data.length, 0)
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
  const row = await db.selectFrom('change_request').select(['summary', 'input']).where('action', '=', 'add_channel').orderBy('created_at', 'desc').executeTakeFirstOrThrow()
  assert.equal(row.summary, 'Add Discord')
  assert.doesNotMatch(row.summary, /fake-discord/)
  const noChannels = await client.callTool({ name: 'add_channel', arguments: { why: 'x', kind: 'discord', botToken: token, origin: app } })
  assert.notEqual(noChannels.isError, true, 'the owner picks its channels in OpenHut')
})

test('a decision the agent never heard about is sent again after a restart', async () => {
  const asked = textOf(await client.callTool({ name: 'update_self', arguments: { why: 'Shorter.', name: 'Op', origin: app } }))
  const id = idIn(asked)
  await changeRequestService.deny({ actor: owner, id })
  await new Promise((resolve) => setTimeout(resolve, 50))
  await db.updateTable('change_request').set({ told: false }).where('id', '=', id).execute()
  const before = told.length
  await changeRequestService.resume()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(told.length, before + 1)
  assert.match(told.at(-1)?.text ?? '', new RegExp(`^\\[OpenHut ${id}\\] Not approved`))
  assert.equal((await db.selectFrom('change_request').select('told').where('id', '=', id).executeTakeFirstOrThrow()).told, true)
})

test('approving again after a crash is safe: a channel already removed counts as done, and the agent can\'t ask to add one it has', async () => {
  const twice = await client.callTool({ name: 'add_channel', arguments: { why: 'x', kind: 'whatsapp', ownerAddress: '+15550002222', open: false, origin: app } })
  assert.equal(twice.isError, true)
  assert.match(textOf(twice), /already have WhatsApp/)
  const asked = textOf(await client.callTool({ name: 'remove_channel', arguments: { why: 'Not used.', id: 'ch_chgwhats', origin: app } }))
  const id = idIn(asked)
  await db.deleteFrom('channel').where('id', '=', 'ch_chgwhats').execute()
  assert.equal((await changeRequestService.approve({ actor: owner, id })).status, 'approved')
})

const DIGITALOCEAN = {
  why: 'To watch prod-db and set up alerts. Changes wait for your OK.',
  name: 'DigitalOcean', line: 'where your database runs', url: 'https://mcp.digitalocean.com/mcp',
  token: { label: 'DigitalOcean token', guide: 'Make a token with read and write access to Databases and Monitoring.', link: 'https://cloud.digitalocean.com/account/api/tokens', scopes: ['database:read', 'database:update'] },
  groups: [
    { group: 'read', label: 'Read database info', permission: 'allow' },
    { group: 'update', label: 'Change database settings', permission: 'ask' },
    { group: 'delete', label: 'Delete databases', permission: 'deny' },
  ],
}
const DO_TOOLS = [
  { name: 'db-cluster-get', description: 'Get a cluster', schema: {}, annotations: { readOnlyHint: true } },
  { name: 'db-cluster-resize', description: 'Resize a cluster', schema: {}, annotations: { readOnlyHint: false } },
  { name: 'db-cluster-delete', description: 'Delete a cluster', schema: {}, annotations: { destructiveHint: true } },
]

test('a proposed connection the owner approves with a token becomes a granted connection with the permissions they picked, and the agent never sees the token', async () => {
  const secret = 'dop_v1_fakeTokenThatMustStayHidden0123456789'
  const probes: unknown[] = []
  mock.method(mcp, 'probe', async (target: unknown) => { probes.push(target); return DO_TOOLS.length })
  mock.method(connectionService, 'specs', async () => DO_TOOLS)
  const asked = await client.callTool({ name: 'propose_connection', arguments: { ...DIGITALOCEAN, origin: app } })
  assert.notEqual(asked.isError, true)
  const id = idIn(textOf(asked))
  assert.match(textOf(asked), /Connect DigitalOcean/)
  await assert.rejects(changeRequestService.approve({ actor: owner, id }), /Paste the DigitalOcean token/)
  const edited = { ...DIGITALOCEAN, groups: DIGITALOCEAN.groups.map((each) => each.group === 'update' ? { ...each, permission: 'deny' } : each) }
  const approved = await changeRequestService.approve({ actor: owner, id, input: edited, token: ` ${secret} ` })
  assert.equal(approved.status, 'approved')
  assert.deepEqual(probes, [{ url: DIGITALOCEAN.url, headers: { Authorization: `Bearer ${secret}` } }])
  const connection = await db.selectFrom('connection').select(['id', 'kind', 'name', 'config']).where('name', '=', 'DigitalOcean').executeTakeFirstOrThrow()
  assert.equal(connection.kind, 'mcp')
  assert.doesNotMatch(connection.config, new RegExp(secret))
  assert.deepEqual(connectionService.unsealed(connection.config), { url: DIGITALOCEAN.url, headers: { Authorization: `Bearer ${secret}` } })
  const grants = await connectionService.reachable({ agent: { id: 'ag_chgagent', owner_id: 'usr_chgowner' } })
  assert.ok(grants.some((grant) => grant.id === connection.id))
  const states = await permissions.list({ agentId: 'ag_chgagent', connectionId: connection.id, tools: DO_TOOLS })
  assert.deepEqual(states.map((each) => [each.name, each.permission]), [['db-cluster-get', 'allow'], ['db-cluster-resize', 'deny'], ['db-cluster-delete', 'deny']])
  await new Promise((resolve) => setTimeout(resolve, 50))
  const row = await db.selectFrom('change_request').select(['input', 'summary']).where('id', '=', id).executeTakeFirstOrThrow()
  const seen = [asked, await client.callTool({ name: 'get_self', arguments: {} })].map((each) => JSON.stringify(each.content))
  for (const text of [row.input, row.summary, JSON.stringify(approved), ...told.map((each) => each.text), ...seen]) assert.doesNotMatch(text, new RegExp(secret))
  assert.match(told.at(-1)?.text ?? '', new RegExp(`^\\[OpenHut ${id}\\] Approved and done: Connect DigitalOcean\\.`))
  mock.restoreAll()
})

test('a bad token leaves no connection behind, and choosing to set it up themselves tells the agent to give steps', async () => {
  mock.method(mcp, 'probe', async () => { throw new Error('401 Unauthorized') })
  const id = idIn(textOf(await client.callTool({ name: 'propose_connection', arguments: { ...DIGITALOCEAN, name: 'Fly', url: 'https://mcp.fly.example/mcp', origin: app } })))
  await assert.rejects(changeRequestService.approve({ actor: owner, id, token: 'wrong-token' }), /didn't answer as an MCP server/)
  assert.equal(await db.selectFrom('connection').select('id').where('name', '=', 'Fly').executeTakeFirst(), undefined)
  await changeRequestService.deny({ actor: owner, id, note: 'I’ll set it up myself' })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.match(told.at(-1)?.text ?? '', /Not connected: Connect Fly\. They chose: "I’ll set it up myself"\..*numbered steps/)
  const twice = await client.callTool({ name: 'propose_connection', arguments: { ...DIGITALOCEAN, groups: [DIGITALOCEAN.groups[0], DIGITALOCEAN.groups[0]], origin: app } })
  assert.equal(twice.isError, true)
  mock.restoreAll()
})

test.after(() => { void client.close(); server.close() })
