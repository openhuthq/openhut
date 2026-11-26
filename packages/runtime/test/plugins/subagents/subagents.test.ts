import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { validatorCompiler } from 'fastify-type-provider-zod'
import { gatewayServer } from '../../../src/server/gateway/gateway-server.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { agentToken, seal } from '../../../src/server/platform/secrets.ts'
import { runSet } from '../../../src/server/agents/run-set.ts'
import { subagentController } from '../../../src/plugins/subagents/subagent-controller.ts'
import { subagentService } from '../../../src/plugins/subagents/subagent-service.ts'
import { fakeAgentd, refresh, signIn } from '../../server/agents/signed-in.ts'

fakeAgentd()
await migrate()
const person = (id: string, role: 'owner' | 'member') => ({ id, email: `${id}@example.com`, role, removed_at: null })
const owner = person('usr_subowner', 'owner')
const other = person('usr_subother', 'member')
await db.insertInto('person').values([owner, other]).execute()
await db.insertInto('agent').values({ id: 'ag_subagnt1', name: 'Scout', owner_id: owner.id, instructions: '# Scout', model: 'claude:sonnet', net: 92, channel_key: seal('k'.repeat(48)) }).execute()
signIn({ email: owner.email })
runSet.watch()
await refresh()
const gateway = gatewayServer.create().listen(0, '127.0.0.1')
await new Promise((resolve) => gateway.once('listening', resolve))
test.after(() => gateway.close())

const AGENT = 'ag_subagnt1'
const hook = (name: string, args: object) => fetch(`http://127.0.0.1:${(gateway.address() as AddressInfo).port}/hooks/${name}`, { method: 'POST', headers: { authorization: `Agent ${agentToken({ id: AGENT, epoch: 0 })}`, 'content-type': 'application/json' }, body: JSON.stringify({ args, origin: {} }) })
const listed = async () => (await subagentService.list({ actor: owner, agentId: AGENT })).map(({ id, title, status }) => `${id} ${status} ${title}`)
const start = (id: string, goal: string) => hook('subagent_start', { parent_session_id: 'p1', parent_turn_id: 't1', parent_subagent_id: null, child_session_id: id, child_subagent_id: `sa-${id}`, child_role: 'leaf', child_goal: goal })
const stop = (id: string, status: string) => hook('subagent_stop', { parent_session_id: 'p1', child_session_id: id, child_role: 'leaf', child_summary: 'ok', child_status: status, tool_call_history: [], duration_ms: 5 })

test('subagent_start adds a working row titled by its goal; subagent_stop marks it done or failed; done rows go after 10 s, the rest after an hour', async () => {
  mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-11-26T10:00:00Z') })
  try {
    assert.equal((await start('c1', 'Research competitors\nand list their prices')).status, 200)
    await start('c2', `Draft ${'a very long goal '.repeat(10)}`)
    await start('c3', 'Find the slow queries')
    await hook('subagent_start', { child_goal: 'no session id' })
    const [, long] = await subagentService.list({ actor: owner, agentId: AGENT })
    assert.equal(long.title.length, 80)
    assert.ok(long.title.endsWith('…'))
    assert.deepEqual([long.object, long.startedAt], ['subagent', '2026-11-26T10:00:00.000Z'])
    await stop('c1', 'completed')
    await stop('c3', 'failed')
    await stop('unknown', 'completed')
    assert.deepEqual((await listed()).map((row) => row.split(' ').slice(0, 2).join(' ')), ['c1 done', 'c2 working', 'c3 failed'])
    mock.timers.tick(10_001)
    assert.deepEqual((await listed()).map((row) => row.split(' ')[0]), ['c2', 'c3'])
    mock.timers.tick(60 * 60_000)
    assert.deepEqual(await listed(), [])
  } finally {
    mock.timers.reset()
  }
})

test('GET /api/agents/:id/subagents is a Stripe-style list for whoever can open the agent, and a 404 for everyone else', async () => {
  await start('c9', 'Check Acme')
  const app = Fastify()
  answerErrors(app)
  app.setValidatorCompiler(validatorCompiler)
  await app.register(subagentController, { prefix: '/api/agents' })
  const res = await app.inject({ method: 'GET', url: `/api/agents/${AGENT}/subagents`, headers: { authorization: 'Bearer test-key' } })
  assert.equal(res.statusCode, 200)
  const list = res.json()
  assert.deepEqual([list.object, list.url, list.hasMore, list.data.map((item: { title: string }) => item.title)], ['list', `/api/agents/${AGENT}/subagents`, false, ['Check Acme']])
  await assert.rejects(subagentService.list({ actor: other, agentId: AGENT }), { status: 404 })
  await assert.rejects(subagentService.list({ actor: owner, agentId: 'ag_nothere0' }), { status: 404 })
})
