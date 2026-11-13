import { randomBytes } from 'node:crypto'
import type { Agent } from '@jakebox/common/agents/agent.ts'
import type { ApiError } from '@jakebox/common/api.ts'
import type { Connection } from '@jakebox/common/connections/connection.ts'
import type { Invite } from '@jakebox/common/team/team.ts'

const APP = 'http://127.0.0.1:8787'
const AGENTS = [
  ['Dev', 'Answers engineering questions in the team channel. Looks up orders and schema in the Orders DB.', 'sonnet', 'running'],
  ['Sales', 'Posts the weekly pipeline report and answers questions about deals.', 'sonnet', 'stopped'],
  ['Support', 'Answers customers in #support. Looks the customer up before replying.', 'haiku', 'running'],
]
const password = randomBytes(9).toString('base64url')

const owner = (await api('POST', '/api/people', { setupCode: process.env.SETUP_CODE ?? 'dev', username: 'mo', password })).cookie
for (const [username, role] of [
  ['sara', 'admin'],
  ['omar', 'member'],
]) {
  const { link } = (await api<Invite>('POST', '/api/invites', { role }, owner)).json
  await api('POST', '/api/people', { inviteToken: link?.split('/invite/')[1], username, password: randomBytes(9).toString('base64url') })
}
const orders = (await api<Connection>('POST', '/api/connections', { name: 'Orders DB', dsn: 'postgres://reader:sample@db.internal.example:5432/orders' }, owner)).json
await api('POST', '/api/connections', { name: 'Analytics warehouse', dsn: 'postgres://reader:sample@warehouse.example:5432/analytics' }, owner)
const ids: Record<string, string> = {}
for (const [name, about, model, wanted] of AGENTS) {
  const agent = (await api<Agent>('POST', '/api/agents', { name, instructions: `# ${name}\n\n${about}` }, owner)).json
  ids[name] = agent.id
  await api('PATCH', `/api/agents/${agent.id}`, { model, wanted }, owner)
}
for (const agentId of [ids.Dev, ids.Support]) await api('POST', '/api/grants', { agentId, connectionId: orders.id }, owner)
console.log(JSON.stringify({ signIn: { username: 'mo', password }, agents: ids, connection: orders.id }))

async function api<T>(method: string, path: string, body?: unknown, cookie = '') {
  const r = await fetch(APP + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json: T & Partial<ApiError> = JSON.parse(await r.text())
  if (!r.ok) throw new Error(`${method} ${path}: ${json.error?.message}`)
  return { json, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] }
}
