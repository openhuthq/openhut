import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { changeRequestService } from '../../../src/server/agents/change-request-service.ts'
import { connectionService, type AgentTool } from '../../../src/server/connections/connection-service.ts'
import { permissions } from '../../../src/server/permissions/permissions.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { fakeAgentd, refresh, signIn } from '../agents/signed-in.ts'

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
const told: string[] = []
changeRequestService.runDashboardWith(async ({ text }) => { told.push(text); return '' })
const settle = () => new Promise((resolve) => setTimeout(resolve, 50))
const idIn = (text: string) => /chg_[a-z0-9]+/.exec(text)?.[0] ?? ''
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
  assert.match(asked.text, /^Waiting for your owner's OK \(chg_[a-z0-9]+\): Run db-cluster-resize on DigitalOcean\./)
  assert.equal(ran.length, before)
  const approved = await changeRequestService.approve({ actor: owner, id: idIn(asked.text) })
  assert.equal(approved.status, 'approved')
  assert.deepEqual(ran.at(-1), { tool: 'db-cluster-resize', args: { size: 'db-s-2vcpu' } })
  await settle()
  assert.match(told.at(-1) ?? '', /Your owner allowed it: Run db-cluster-resize on DigitalOcean\. The result:\n\n\{"ran":"db-cluster-resize","password":"\[hidden\]"\}/)
  assert.deepEqual((await events()).slice(-2), [
    { tool: 'mcp_db-cluster-resize', outcome: 'asked', approved_by: null },
    { tool: 'mcp_db-cluster-resize', outcome: 'allowed', approved_by: 'usr_permowner' },
  ])
})

test('Always allow saves the override, so the next call runs without asking', async () => {
  const asked = await connectionService.call({ agent, name: 'mcp_db-cluster-resize', args: {}, reason: 'Again', origin: app })
  await changeRequestService.approve({ actor: owner, id: idIn(asked.text), always: true })
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
  await changeRequestService.deny({ actor: owner, id: idIn(asked.text) })
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
  const results = await Promise.allSettled([changeRequestService.approve({ actor: owner, id: idIn(asked.text) }), changeRequestService.approve({ actor: owner, id: idIn(asked.text) })])
  assert.deepEqual(results.map((each) => each.status).sort(), ['fulfilled', 'rejected'])
  assert.equal(ran.length, before + 1)
})

test('a request nobody answers expires and the agent hears about it', async () => {
  const asked = await connectionService.call({ agent, name: 'mcp_db-cluster-resize', args: {}, reason: 'Night run', origin: app })
  const id = idIn(asked.text)
  await db.updateTable('change_request').set({ expires_at: new Date(Date.now() - 1000) }).where('id', '=', id).execute()
  await assert.rejects(changeRequestService.approve({ actor: owner, id }), /already expired/)
  await settle()
  assert.match(told.at(-1) ?? '', new RegExp(`\\[OpenHut ${id}\\] Nobody answered in time`))
})
