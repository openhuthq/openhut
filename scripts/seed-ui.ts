import type { Agent } from '@openhut/common/agents/agent.ts'
import type { ApiError } from '@openhut/common/api.ts'
import type { Cloud, CloudAuthorization, RecoveryKit } from '@openhut/common/cloud/cloud.ts'
import type { Connection } from '@openhut/common/connections/connection.ts'
import { setTimeout as sleep } from 'node:timers/promises'

const APP = `http://127.0.0.1:${process.env.PORT ?? 8787}`
const EMAIL = process.env.OPENHUT_DEV_EMAIL ?? 'mo@example.com'
const AGENTS = [
  ['Dev', 'Answers engineering questions in the team channel. Looks up orders and schema in the Orders DB.', 'claude:sonnet', 'running'],
  ['Sales', 'Posts the weekly pipeline report and answers questions about deals.', 'claude:sonnet', 'stopped'],
  ['Support', 'Answers customers in #support. Looks the customer up before replying.', 'claude:haiku', 'running'],
]
const words = await signIn()
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
console.log(JSON.stringify({ email: EMAIL, kit: words, agents: ids, connection: orders.id }))

async function signIn(): Promise<string[] | undefined> {
  if ((await api<Cloud>('GET', '/api/cloud')).json.status === 'off') {
    let url = (await api<CloudAuthorization>('POST', '/api/cloud/sessions')).json.authorizationUrl
    for (let hop = 0; hop < 5 && !url.includes('/v1/dev/sign-in'); hop++) url = new URL((await fetch(url, { redirect: 'manual' })).headers.get('location') ?? '', url).href
    const link = new RegExp(`href="([^"]+)">${EMAIL}<`).exec(await (await fetch(url)).text())?.[1]?.replaceAll('&amp;', '&')
    if (!link) throw new Error(`The dev sign-in page at ${url} doesn't offer ${EMAIL}. Run npm run dev with private/api checked out.`)
    const back = new URL((await fetch(link)).url).searchParams.get('to')
    if (back) await fetch(back)
  }
  for (let tries = 0; tries < 50; tries++) {
    const cloud = (await api<Cloud>('GET', '/api/cloud')).json
    if (cloud.status === 'locked') throw new Error(`${EMAIL} already has an account in the dev cloud. Unlock it in the app, or start from a fresh .data.`)
    if (cloud.status === 'on' && cloud.kit) return undefined
    if (cloud.status === 'on') return (await api<RecoveryKit>('POST', '/api/cloud/kits')).json.words
    await sleep(200)
  }
  throw new Error('Sign-in didn’t finish. Check the dev cloud’s log.')
}

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
