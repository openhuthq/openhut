import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { changeRequestService } from '../../../src/server/agents/change-request-service.ts'
import { connectionService } from '../../../src/server/connections/connection-service.ts'
import { gatewayServer } from '../../../src/server/gateway/gateway-server.ts'
import { permissions } from '../../../src/server/permissions/permissions.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { agentToken, seal } from '../../../src/server/platform/secrets.ts'
import { fakeAgentd, refresh, signIn } from '../agents/signed-in.ts'
import { fakeDigitalOcean } from './fixtures/fake-digitalocean.ts'

fakeAgentd()
const digitalocean = await fakeDigitalOcean()
await migrate()
const owner = { id: 'usr_doowner', email: 'do@example.com', role: 'owner' as const }
await db.insertInto('person').values({ id: owner.id, email: owner.email, role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_doagent', name: 'Database', owner_id: owner.id, instructions: '#', model: 'claude:sonnet', net: 73, channel_key: seal('k'.repeat(48)), wanted: 'stopped' }).execute()
await db.insertInto('connection').values({ id: 'cn_dofake0001', kind: 'mcp', name: 'DigitalOcean', owner_id: owner.id, config: seal(JSON.stringify({ url: digitalocean?.url ?? 'http://192.0.2.1/mcp' })) }).execute()
await db.insertInto('connection_grant').values({ id: 'gr_dofake0001', connection_id: 'cn_dofake0001', agent_id: 'ag_doagent', created_at: new Date() }).execute()
signIn({ email: owner.email })
await refresh()
changeRequestService.runDashboardWith(async () => '')

const server = gatewayServer.create().listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const client = new Client({ name: 'hermes', version: '1' })
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/mcp`), { requestInit: { headers: { authorization: `Agent ${agentToken({ id: 'ag_doagent', epoch: 0 })}` } } }))
const invoke = async (name: string) => {
  const result = await client.callTool({ name: 'call_tool', arguments: { reason: 'Check the cluster', name: 'mcp_mcp_invoke_tool', arguments: { name, arguments: {} }, origin: { platform: 'api_server', chat_id: 'openhut-dosession' } } }) as { content: { text: string }[]; isError?: boolean }
  return { text: result.content[0].text, isError: result.isError === true }
}
const skip = digitalocean ? false : 'no non-loopback address to serve the fake MCP server on'
test.after(() => { void client.close(); server.close(); digitalocean?.close() })

test('each call through a catch-all tool follows the permission of the action it runs', { skip }, async () => {
  const fake = digitalocean!
  const read = await invoke('databases/db-cluster-list')
  assert.deepEqual(read, { text: '{"ran":"databases/db-cluster-list"}', isError: false })

  const deleted = await invoke('databases/db-cluster-delete')
  assert.match(deleted.text, /^Not allowed: your owner set Delete a database on DigitalOcean to Never/)

  await permissions.set({ actor: owner, agentId: 'ag_doagent', connectionId: 'cn_dofake0001', tools: ['*delete'], state: 'ask' })
  const asked = await invoke('databases/db-cluster-delete')
  assert.match(asked.text, /^Waiting for your owner's OK \(chg_[a-z0-9]+\): DigitalOcean: Delete a database\./)

  const unknown = await invoke('apps/app-mystery')
  assert.match(unknown.text, /: DigitalOcean: App mystery\./)
  assert.deepEqual(fake.invoked, ['databases/db-cluster-list'])

  const id = /chg_[a-z0-9]+/.exec(asked.text)?.[0] ?? ''
  await changeRequestService.approve({ actor: owner, id, always: true })
  assert.deepEqual(fake.invoked, ['databases/db-cluster-list', 'databases/db-cluster-delete'])
  assert.equal(fake.lookups.filter((each) => each.endsWith('databases/db-cluster-delete')).length, 2)

  const listed = await permissions.list({ agentId: 'ag_doagent', connectionId: 'cn_dofake0001', tools: await connectionService.specs({ actor: owner, connectionId: 'cn_dofake0001' }) })
  assert.ok(!listed.some((each) => each.name === 'mcp_invoke_tool'))
  assert.deepEqual(listed.filter((each) => each.name.includes('/')).map((each) => [each.name, each.group, each.permission]), [
    ['databases/db-cluster-list', 'read', 'allow'],
    ['databases/db-cluster-delete', 'delete', 'allow'],
    ['apps/app-mystery', 'other', 'ask'],
  ])
})
