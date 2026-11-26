import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { gatewayServer } from '../../../src/server/gateway/gateway-server.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { agentToken, seal } from '../../../src/server/platform/secrets.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_askowner', email: 'ask@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_askagent', name: 'Juniper', owner_id: 'usr_askowner', instructions: '#', model: 'claude:sonnet', net: 72, channel_key: seal('k'.repeat(48)), wanted: 'running' }).execute()

const server = gatewayServer.create().listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const client = new Client({ name: 'hermes', version: '1' })
await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/v1/mcp`), { requestInit: { headers: { authorization: `Agent ${agentToken({ id: 'ag_askagent', epoch: 0 })}` } } }))

const call = (args: Record<string, unknown>) => client.callTool({ name: 'ask_to_connect', arguments: args }) as Promise<{ content: { text: string }[]; isError?: boolean }>

test('ask_to_connect gives one card listing every app, each opening its sheet for this agent', async () => {
  const result = await call({ why: 'One short sign-in each.', apps: [{ app: 'postgres', line: 'read your database' }, { app: 'github' }, { app: 'linear', line: 'open tickets' }] })
  assert.ok(!result.isError)
  const text = result.content[0].text
  assert.match(text, /```spec\n/)
  assert.match(text, /"title":"Connect apps"/)
  assert.equal(text.match(/"type":"Connect"/g)?.length, 3)
  for (const app of ['postgres', 'github', 'linear']) assert.match(text, new RegExp(`https://openhut\\.dev/open#/connections/new/${app}\\?for=ag_askagent`))
})

test('ask_to_connect fills in an MCP server and refuses a url for anything else', async () => {
  const mcp = await call({ why: 'CPU and alerts.', apps: [{ app: 'mcp', url: 'https://mcp.digitalocean.com/mcp', name: 'DigitalOcean' }] })
  assert.match(mcp.content[0].text, /\/connections\/new\/mcp\?for=ag_askagent&url=https%3A%2F%2Fmcp\.digitalocean\.com%2Fmcp&name=DigitalOcean/)
  assert.match(mcp.content[0].text, /"title":"Connect DigitalOcean"/)
  assert.match(mcp.content[0].text, /"brand":"digitalocean"/)
  const cloudflare = await call({ why: 'Workers logs.', apps: [{ app: 'mcp', url: 'https://observability.mcp.cloudflare.com/mcp', name: 'Cloudflare', auth: 'sign_in' }] })
  assert.match(cloudflare.content[0].text, /name=Cloudflare&auth=sign_in/)
  assert.equal((await call({ why: 'x', apps: [{ app: 'postgres', auth: 'sign_in' }] })).isError, true)
  assert.equal((await call({ why: 'x', apps: [{ app: 'github' }, { app: 'mcp' }] })).isError, true)
  assert.equal((await call({ why: 'x', apps: [{ app: 'github', url: 'https://example.com' }] })).isError, true)
  assert.equal((await call({ why: 'x', apps: [{ app: 'mcp', url: 'http://example.com/mcp' }] })).isError, true)
  assert.equal((await call({ why: 'x', apps: [{ app: 'oracle' }] })).isError, true)
  assert.equal((await call({ why: 'x', apps: [] })).isError, true)
})

test.after(() => { void client.close(); server.close() })

test('every openhut tool takes the origin the Hermes plugin stamps on it', async () => {
  const { tools } = await client.listTools()
  assert.ok(tools.length >= 16)
  assert.ok(!tools.some((tool) => tool.name === 'post_message'), 'a local tool runs in Hermes, not over MCP')
  for (const tool of tools) assert.deepEqual(tool.inputSchema.additionalProperties, {}, `${tool.name} drops origin`)
  const origin = { platform: 'slack', chat_id: 'C1' }
  assert.ok(!(await client.callTool({ name: 'list_routines', arguments: { origin } })).isError)
  assert.ok(!(await call({ why: 'x', apps: [{ app: 'github' }], origin })).isError)
})
