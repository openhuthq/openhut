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

test('ask_to_connect gives a card that opens the sheet for this agent', async () => {
  const result = await call({ app: 'postgres', why: 'To watch postgres-eu for regressions.' })
  assert.ok(!result.isError)
  assert.match(result.content[0].text, /```spec\n/)
  assert.match(result.content[0].text, /https:\/\/openhut\.dev\/open#\/connections\/new\/postgres\?for=ag_askagent/)
})

test('ask_to_connect fills in an MCP server and refuses a url for anything else', async () => {
  const mcp = await call({ app: 'mcp', why: 'CPU and alerts.', url: 'https://mcp.digitalocean.com/mcp', name: 'DigitalOcean' })
  assert.match(mcp.content[0].text, /\/connections\/new\/mcp\?for=ag_askagent&url=https%3A%2F%2Fmcp\.digitalocean\.com%2Fmcp&name=DigitalOcean/)
  assert.match(mcp.content[0].text, /Connect DigitalOcean/)
  assert.match(mcp.content[0].text, /"brand":"digitalocean"/)
  const cloudflare = await call({ app: 'mcp', why: 'Workers logs.', url: 'https://observability.mcp.cloudflare.com/mcp', name: 'Cloudflare', auth: 'sign_in' })
  assert.match(cloudflare.content[0].text, /name=Cloudflare&auth=sign_in/)
  assert.equal((await call({ app: 'postgres', why: 'x', auth: 'sign_in' })).isError, true)
  assert.equal((await call({ app: 'mcp', why: 'x' })).isError, true)
  assert.equal((await call({ app: 'github', why: 'x', url: 'https://example.com' })).isError, true)
  assert.equal((await call({ app: 'mcp', why: 'x', url: 'http://example.com/mcp' })).isError, true)
  assert.equal((await call({ app: 'oracle', why: 'x' })).isError, true)
})

test.after(() => { void client.close(); server.close() })
