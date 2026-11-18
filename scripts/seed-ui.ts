import type { Agent } from '@openhut/common/agents/agent.ts'
import type { ApiError } from '@openhut/common/api.ts'
import type { Connection } from '@openhut/common/connections/connection.ts'

const APP = `http://127.0.0.1:${process.env.PORT ?? 8787}`
const AGENTS = [
  ['Dev', 'Answers engineering questions in the team channel. Looks up orders and schema in the Orders DB.', 'claude:sonnet', 'running'],
  ['Sales', 'Posts the weekly pipeline report and answers questions about deals.', 'claude:sonnet', 'stopped'],
  ['Support', 'Answers customers in #support. Looks the customer up before replying.', 'claude:haiku', 'running'],
]
const orders = (
  await api<Connection>('POST', '/api/connections', { name: 'Orders DB', dsn: 'postgres://reader:sample@db.internal.example:5432/orders' })
).json
await api('POST', '/api/connections', { name: 'Analytics warehouse', dsn: 'postgres://reader:sample@warehouse.example:5432/analytics' })
const ids: Record<string, string> = {}
for (const [name, about, model, wanted] of AGENTS) {
  const agent = (await api<Agent>('POST', '/api/agents', { name, instructions: `# ${name}\n\n${about}` })).json
  ids[name] = agent.id
  await api('PATCH', `/api/agents/${agent.id}`, { model, wanted })
}
for (const agentId of [ids.Dev, ids.Support]) await api('POST', '/api/grants', { agentId, connectionId: orders.id })
console.log(JSON.stringify({ agents: ids, connection: orders.id }))

async function api<T>(method: string, path: string, body?: unknown) {
  const r = await fetch(APP + path, {
    method,
    headers: { authorization: 'Bearer dev', ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json: T & Partial<ApiError> = JSON.parse(await r.text())
  if (!r.ok) throw new Error(`${method} ${path}: ${json.error?.message}`)
  return { json }
}
