import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { gatewayServer } from '../../../src/server/gateway/gateway-server.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { agentToken, seal } from '../../../src/server/platform/secrets.ts'
import { routineService } from '../../../src/server/inbox/routines.ts'
import { inboxService } from '../../../src/server/inbox/inbox-service.ts'
import { activity } from '../../../src/server/gateway/activity.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_rtgowner', email: 'rtg@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_rtgagent', name: 'Dev', owner_id: 'usr_rtgowner', instructions: '#', model: 'claude:sonnet', net: 71, channel_key: seal('k'.repeat(48)), wanted: 'running' }).execute()
await db.insertInto('channel').values({ id: 'ch_rtgwhats', agent_id: 'ag_rtgagent', kind: 'whatsapp', status: 'connected', account: null, owner_address: '15550002222', open: true, allowed: '', secrets: '' }).execute()

const server = gatewayServer.create().listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
const token = agentToken({ id: 'ag_rtgagent', epoch: 0 })
const headers = { authorization: `Agent ${token}`, 'content-type': 'application/json' }
const origin = { platform: 'whatsapp', chat_id: '15550002222@s.whatsapp.net', chat_type: 'dm', chat_name: 'Mo', user_id: '15550002222' }

async function mcp() {
  const client = new Client({ name: 'hermes', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/api/v1/mcp`), { requestInit: { headers: { authorization: `Agent ${token}` } } }))
  return client
}

const textOf = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { text: string }[])[0].text

test('the wakes poll and MCP keepalives are not activity, so an idle Cloud computer can pause', async () => {
  assert.equal((await fetch(`${base}/wakes`, { headers })).status, 200)
  await fetch(`${base}/api/v1/mcp`, { method: 'POST', headers: { ...headers, accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })
  assert.equal(activity.recent(60_000), false)
})

test('the agent sees three routine tools, and origin is not in the schema it gets', async () => {
  const client = await mcp()
  const { tools } = await client.listTools()
  const names = tools.map((tool) => tool.name)
  for (const name of ['schedule_routine', 'list_routines', 'cancel_routine']) assert.ok(names.includes(name), name)
  const schedule = tools.find((tool) => tool.name === 'schedule_routine')
  assert.deepEqual(Object.keys(schedule?.inputSchema.properties ?? {}).sort(), ['at', 'cron', 'name', 'plan', 'until'])
  await client.close()
})

test('a routine scheduled over MCP with the plugin\'s origin runs as a wake: listed, picked and reported', async () => {
  const client = await mcp()
  const refused = await client.callTool({ name: 'schedule_routine', arguments: { name: 'Remind Mo', plan: 'Board update.', at: new Date(Date.now() + 600_000).toISOString() } })
  assert.equal(refused.isError, true)
  assert.match(textOf(refused), /chat you're in/)
  const scheduled = await client.callTool({ name: 'schedule_routine', arguments: { name: 'Remind Mo', plan: 'Board update.', cron: '0 9 * * 5', origin } })
  assert.match(textOf(scheduled), /^Scheduled rt_[a-z0-9]+, next .+\. Reports go to your WhatsApp\.$/)
  const id = /rt_[a-z0-9]+/.exec(textOf(scheduled))?.[0] ?? ''
  assert.match(textOf(await client.callTool({ name: 'list_routines', arguments: {} })), new RegExp(`^${id} Remind Mo · 0 9 \\* \\* 5 · next `))

  await db.updateTable('inbox_source').set({ next_run_at: new Date(Date.now() - 60_000) }).where('id', '=', id).execute()
  await inboxService.tick()
  const due = await (await fetch(`${base}/wakes`, { headers })).json() as { data: { id: string; text: string; origin: unknown }[] }
  assert.equal(due.data.length, 1)
  assert.deepEqual(due.data[0].origin, origin)
  assert.match(due.data[0].id, /^inbox:ru_[a-z0-9]+$/)
  assert.match(due.data[0].text, new RegExp(`^\\[OpenHut ${due.data[0].id}\\] Routine ${id}: time for "Remind Mo"`))
  assert.match(due.data[0].text, /then call cancel_routine\.$/)
  const runUrl = `${base}/wakes/${due.data[0].id}`
  assert.equal((await fetch(`${base}/wakes/nope:ru_x`, { method: 'POST', headers, body: JSON.stringify({ picked: true }) })).status, 404)
  assert.equal((await fetch(runUrl, { method: 'POST', headers, body: JSON.stringify({}) })).status, 400)
  assert.equal((await fetch(runUrl, { method: 'POST', headers, body: JSON.stringify({ picked: true }) })).status, 200)
  assert.equal((await fetch(runUrl, { method: 'POST', headers: { ...headers, authorization: 'Agent nope' }, body: JSON.stringify({ said: 'x' }) })).status, 401)
  assert.equal((await fetch(runUrl, { method: 'POST', headers, body: JSON.stringify({ said: 'Reminded Mo.' }) })).status, 200)
  assert.equal((await fetch(runUrl, { method: 'POST', headers, body: JSON.stringify({ said: 'again' }) })).status, 404)
  const row = await db.selectFrom('inbox_source').selectAll().where('id', '=', id).executeTakeFirstOrThrow()
  assert.deepEqual({ status: row.run_status, text: row.run_text }, { status: 'told', text: 'Reminded Mo.' })

  assert.equal(textOf(await client.callTool({ name: 'cancel_routine', arguments: { id, reason: 'Sent' } })), 'Stopped.')
  assert.equal(textOf(await client.callTool({ name: 'list_routines', arguments: {} })), 'No routines.')
  await client.close()
  server.close()
})
