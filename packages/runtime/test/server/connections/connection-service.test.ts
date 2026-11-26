import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { asks } from '../../../src/core/asks.ts'
import { connectionService, toolsShown, type AgentTool } from '../../../src/server/connections/connection-service.ts'
import { permissions } from '../../../src/server/permissions/permissions.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { fakeAgentd, refresh, signIn } from '../agents/signed-in.ts'
import { appWakes } from '../../plugins/chat/app-wakes.ts'

fakeAgentd()
await migrate()
await db.insertInto('person').values({ id: 'usr_permowner', email: 'perm@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_permagent', name: 'Pulse', owner_id: 'usr_permowner', instructions: '#', model: 'claude:sonnet', net: 74, channel_key: seal('k'.repeat(48)), wanted: 'stopped' }).execute()
await db.insertInto('connection').values({ id: 'cn_permdo0001', kind: 'mcp', name: 'DigitalOcean', owner_id: 'usr_permowner', config: seal('{}') }).execute()
signIn({ email: 'perm@example.com' })
await refresh()

const owner = { id: 'usr_permowner', email: 'perm@example.com', role: 'owner' as const }
const agent = { id: 'ag_permagent', owner_id: 'usr_permowner' }
const app = { platform: 'api_server', chat_id: 'openhut-permsession' }
const connection = { id: 'cn_permdo0001', kind: 'mcp' as const, name: 'DigitalOcean' }
const tool = (name: string, annotations: AgentTool['spec']['annotations']): AgentTool => ({ name: `mcp_${name}`, connection, spec: { name, description: name, schema: {}, annotations } })
const TOOLS = [tool('db-cluster-get', { readOnlyHint: true }), tool('db-cluster-resize', { destructiveHint: false }), tool('db-cluster-delete', { destructiveHint: true })]
mock.method(connectionService, 'tools', async () => TOOLS)
const ran: { tool: string; args: Record<string, unknown> }[] = []
mock.method(connectionService, 'execute', async ({ tool: name, args }: { tool: string; args: Record<string, unknown> }) => {
  ran.push({ tool: name, args })
  return { text: JSON.stringify({ ran: name, password: 'hunter2' }), isError: false }
})
const chat = appWakes()
const told = { at: (index: number) => chat.told.at(index)?.text }
const settle = () => chat.settled()
const idIn = (text: string) => /ask_[a-z0-9]+/.exec(text)?.[0] ?? ''
const events = () => db.selectFrom('connection_event').select(['tool', 'outcome', 'approved_by']).where('agent_id', '=', agent.id).orderBy('id').execute()

test('a read runs at once and its secrets are hidden', async () => {
  const result = await connectionService.call({ agent, name: 'mcp_db-cluster-get', args: {}, reason: 'Check health', origin: app })
  assert.equal(result.isError, false)
  assert.match(result.text, /"password":"\[hidden\]"/)
  assert.doesNotMatch(result.text, /hunter2/)
})

test('a write waits for the OK, runs on approval and the result reaches the agent', async () => {
  const before = ran.length
  const asked = await connectionService.call({ agent, name: 'mcp_db-cluster-resize', args: { size: 'db-s-2vcpu' }, reason: 'Queries are waiting', origin: app })
  assert.match(asked.text, /^Asked for approval \(ask_[a-z0-9]+\): Run db-cluster-resize on DigitalOcean\./)
  assert.equal(ran.length, before)
  const approved = await asks.approve({ actor: owner, id: idIn(asked.text) })
  assert.equal(approved.status, 'done')
  assert.deepEqual(ran.at(-1), { tool: 'db-cluster-resize', args: { size: 'db-s-2vcpu' } })
  await settle()
  assert.match(told.at(-1) ?? '', /Approved and done: Run db-cluster-resize on DigitalOcean\. The result:\n\n\{"ran":"db-cluster-resize","password":"\[hidden\]"\}/)
  assert.deepEqual((await events()).slice(-2), [
    { tool: 'mcp_db-cluster-resize', outcome: 'asked', approved_by: null },
    { tool: 'mcp_db-cluster-resize', outcome: 'allowed', approved_by: 'usr_permowner' },
  ])
})

test('Always allow saves the override, so the next call runs without asking', async () => {
  const asked = await connectionService.call({ agent, name: 'mcp_db-cluster-resize', args: {}, reason: 'Again', origin: app })
  await asks.approve({ actor: owner, id: idIn(asked.text), answer: { always: true } })
  const listed = await permissions.list({ agentId: agent.id, connectionId: connection.id, tools: TOOLS.map((each) => each.spec) })
  assert.deepEqual(listed.map((each) => [each.name, each.permission, each.isDefault]), [['db-cluster-get', 'allow', true], ['db-cluster-resize', 'allow', false], ['db-cluster-delete', 'deny', true]])
  const direct = await connectionService.call({ agent, name: 'mcp_db-cluster-resize', args: {}, reason: 'Third time', origin: app })
  assert.match(direct.text, /"ran":"db-cluster-resize"/)
  await permissions.reset({ actor: owner, agentId: agent.id, connectionId: connection.id })
  assert.equal(await permissions.decide({ agentId: agent.id, connectionId: connection.id, spec: TOOLS[1].spec }), 'ask')
})

test('Don\'t allow tells the agent and nothing runs; Never refuses outright', async () => {
  const before = ran.length
  const asked = await connectionService.call({ agent, name: 'mcp_db-cluster-resize', args: {}, reason: 'Bigger', origin: app })
  await asks.decline({ actor: owner, id: idIn(asked.text) })
  await settle()
  assert.match(told.at(-1) ?? '', /Not approved: Run db-cluster-resize on DigitalOcean\./)
  const never = await connectionService.call({ agent, name: 'mcp_db-cluster-delete', args: {}, reason: 'Clean up', origin: app })
  assert.equal(never.isError, true)
  assert.match(never.text, /^Not allowed/)
  assert.equal(ran.length, before)
  assert.deepEqual((await events()).slice(-2).map((each) => [each.outcome, each.approved_by]), [['denied', 'usr_permowner'], ['denied', null]])
})

test('two clicks on Allow once run the call once', async () => {
  const asked = await connectionService.call({ agent, name: 'mcp_db-cluster-resize', args: {}, reason: 'Twice', origin: app })
  const before = ran.length
  const results = await Promise.all([asks.approve({ actor: owner, id: idIn(asked.text) }), asks.approve({ actor: owner, id: idIn(asked.text) })])
  assert.deepEqual(results.map((each) => each.status), ['done', 'done'], 'the second click waits for the first and gets the same answer')
  assert.equal(ran.length, before + 1)
})

test('a request nobody answers expires and the agent hears about it', async () => {
  const asked = await connectionService.call({ agent, name: 'mcp_db-cluster-resize', args: {}, reason: 'Night run', origin: app })
  const id = idIn(asked.text)
  await db.updateTable('ask').set({ expires_at: new Date(Date.now() - 1000) }).where('id', '=', id).execute()
  assert.equal((await asks.approve({ actor: owner, id })).status, 'expired')
  await settle()
  assert.match(told.at(-1) ?? '', /\[OpenHut asks:wk_[a-z0-9]+\] Your owner answered your ask:\n- Nobody answered in time/)
})

test('an app\'s status follows its latest call, and apps list by name', async () => {
  const add = (id: string, kind: 'linear' | 'postgres', name: string) => db.insertInto('connection').values({ id, kind, name, owner_id: 'usr_permowner', config: seal('{}') }).execute()
  await add('cn_permpg00001', 'postgres', 'postgres')
  await add('cn_permlin0001', 'linear', 'Linear')
  const call = (connectionId: string, outcome: 'allowed' | 'failed', minutesAgo: number) => db.insertInto('connection_event').values({ agent_id: agent.id, connection_id: connectionId, tool: 'x', reason: 'r', outcome, ms: 1, approved_by: null, at: new Date(Date.now() - minutesAgo * 60_000) }).execute()
  for (const minutes of [4, 3, 2, 1]) await call('cn_permpg00001', 'failed', minutes)
  await call('cn_permlin0001', 'failed', 5)
  await call('cn_permlin0001', 'allowed', 1)
  const listed = await connectionService.list({ actor: owner })
  assert.deepEqual(listed.map((each) => each.name).filter((name) => ['DigitalOcean', 'Linear', 'postgres'].includes(name)), ['DigitalOcean', 'Linear', 'postgres'])
  const status = Object.fromEntries(listed.map((each) => [each.name, each.status]))
  assert.equal(status.postgres, 'failing')
  assert.equal(status.Linear, 'connected')
  await call('cn_permlin0001', 'failed', 0)
  assert.equal((await connectionService.get({ actor: owner, id: 'cn_permlin0001' })).status, 'failing')
})

test('reconnect swaps the key in place: the same id, its grants and its tool permissions stay', async () => {
  const made = await connectionService.create({ actor: owner, kind: 'postgres', name: 'Orders', dsn: 'postgres://reader:old@db-a:5432/orders' })
  await db.insertInto('connection_grant').values({ id: 'grt_recon01', connection_id: made.id, agent_id: agent.id, created_at: new Date().toISOString() }).execute()
  await db.insertInto('tool_permission').values({ agent_id: agent.id, connection_id: made.id, tool: 'postgres_query', state: 'allow', changed_by: owner.id }).execute()
  const again = await connectionService.reconnect({ actor: owner, id: made.id, dsn: 'postgres://reader:new@db-b:5432/orders' })
  assert.deepEqual([again.id, again.account], [made.id, 'db-b/orders'])
  assert.equal(connectionService.unsealed((await connectionService.owned({ id: made.id })).config).dsn, 'postgres://reader:new@db-b:5432/orders')
  assert.equal((await db.selectFrom('connection_grant').selectAll().where('connection_id', '=', made.id).execute()).length, 1)
  assert.equal((await db.selectFrom('tool_permission').selectAll().where('connection_id', '=', made.id).execute()).length, 1)
  assert.equal((await connectionService.list({ actor: owner })).filter((each) => each.name === 'Orders').length, 1)
})

test('a sign-in app reconnects by signing in again, not with a key', async () => {
  await db.insertInto('connection').values({ id: 'cn_reconlin01', kind: 'linear', name: 'Linear', owner_id: owner.id, config: seal('{}'), sign_in: true }).execute()
  await assert.rejects(connectionService.reconnect({ actor: owner, id: 'cn_reconlin01', token: 'x' }), /signing in/)
})

test('an app page names its tools plainly: lookups hidden behind a catch-all, which shows the actions it reached with their group', () => {
  const spec = (name: string, extra = {}) => ({ name, description: name, schema: {}, ...extra })
  const tools = [spec('find_tools', { annotations: { readOnlyHint: true } }), spec('invoke_tool'), spec('retrieve_schema', { annotations: { readOnlyHint: true } })]
  const shown = (discovered: ReturnType<typeof spec>[]) => toolsShown({ connection, tools, discovered }).map((each) => [each.kind, each.label, each.group])
  assert.deepEqual(shown([]), [['catch_all', 'Any DigitalOcean action', 'other']])
  assert.deepEqual(shown([spec('droplet-list', { description: 'List droplets', annotations: { readOnlyHint: true } }), spec('droplet-delete', { annotations: { title: 'Delete a droplet', destructiveHint: true } })]),
    [['catch_all', 'Any DigitalOcean action', 'other'], ['action', 'List droplets', 'read'], ['action', 'Delete a droplet', 'delete']])
  assert.deepEqual(toolsShown({ connection: { kind: 'linear', name: 'Linear' }, tools: [spec('list_issues'), spec('find_user')], discovered: [] }).map((each) => [each.kind, each.label, each.name]),
    [['tool', 'List issues', 'linear_list_issues'], ['tool', 'Find user', 'linear_find_user']])
})
