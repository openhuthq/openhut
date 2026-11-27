import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { agent as hermes, type AgentEvents } from '../../../src/core/agent.ts'
import { plugins } from '../../../src/core/plugins.ts'
import { resolveSlots } from '../../../src/server/models/model-slots.ts'
import { agentd } from '../../../src/server/platform/agentd.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_drvownr0', email: 'driver@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_driver00', name: 'Ops', owner_id: 'usr_drvownr0', instructions: '#', model: 'claude:sonnet', net: 21, channel_key: seal('k'.repeat(32)) }).execute()
const heard: AgentEvents['content.written']['in'][] = []
const order: string[] = []
plugins().push({ name: 'probe', on: { 'content.written': async ({ event }) => { order.push('written'); heard.push(event); return undefined } } })
const paths: string[] = []
mock.method(agentd, 'write', async ({ path }: { path: string }) => { paths.push(path); return { path: path === 'home/uploads/a.txt' ? 'home/uploads/a-2.txt' : path } })
mock.method(agentd, 'apply', async ({ id }: { id: string }) => { order.push('apply'); return { applied: id, change: 'none' as const } })

test('a person\'s write lands at the Hermes path and raises content.written with where it was saved', async () => {
  assert.deepEqual(await hermes.content.write({ id: 'ag_driver00', ref: { kind: 'memory', name: 'USER' }, body: 'Likes tea', by: 'person', create: true }), { kind: 'memory', name: 'USER' })
  assert.deepEqual(await hermes.content.write({ id: 'ag_driver00', ref: { kind: 'skill', name: 'research/arxiv' }, body: 'x', by: 'person' }), { kind: 'skill', name: 'research/arxiv' })
  assert.deepEqual(await hermes.content.write({ id: 'ag_driver00', ref: { kind: 'upload', name: 'a.txt' }, body: 'x', by: 'person' }), { kind: 'file', name: 'uploads/a-2.txt' })
  assert.deepEqual(paths, ['memories/USER.md', 'skills/research/arxiv/SKILL.md', 'home/uploads/a.txt'])
  assert.deepEqual(heard.map((each) => each.ref.kind), ['memory', 'skill', 'file'])
  assert.ok(heard.every((each) => each.by === 'person'))
})

test('changed instructions raise content.written after agentd has applied them (and refreshed the prompts)', async () => {
  const slots = resolveSlots({ model: 'claude:sonnet', catalog: () => [{ id: 'sonnet', name: 'sonnet', on: true, tier: 'big', note: null, contextLength: null, inputPrice: null, outputPrice: null }] })
  const setup = (instructions: string) => hermes.setup({ ctx: { agent: { id: 'ag_driver00', name: 'Ops', instructions, slots, net: 21, code_execution: true, web_browser: false }, token: 't', channelKey: 'k'.repeat(32), channels: [], connections: [], secrets: [] }, browser: false, running: true })
  heard.length = 0
  order.length = 0
  await setup('# Ops')
  await setup('# Ops')
  await setup('# Ops, now on call')
  assert.deepEqual(order, ['apply', 'apply', 'apply', 'written'])
  assert.deepEqual(heard, [{ ref: { kind: 'instructions', name: 'SOUL' }, by: 'person' }])
})
