import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { agentService } from '../../../src/server/agents/agent-service.ts'
import { runSet } from '../../../src/server/agents/run-set.ts'
import { fakeComputer } from '../relay/fake-computer.ts'
import { signIn } from './signed-in.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_mover001', email: 'mover@example.com', role: 'owner', removed_at: null }).execute()
for (const id of ['cm_sourcebx', 'cm_targetbx']) await db.insertInto('computer').values({ id, name: id, token_hash: id, expires_at: null }).execute()
signIn()
runSet.watch()
const actor = { id: 'usr_mover001', email: 'mover@example.com', role: 'owner' as const }
const source = fakeComputer({ id: 'cm_sourcebx' })
const target = fakeComputer({ id: 'cm_targetbx' })
const runsOn = async (id: string) => (await db.selectFrom('agent').select('runs_on').where('id', '=', id).executeTakeFirstOrThrow()).runs_on

test('a move stops the agent, copies its home through the relay, starts it on the other computer and deletes it on the first', async () => {
  const agent = await agentService.create({ actor, name: 'Mover', runsOn: 'cm_sourcebx' })
  await agentService.update({ actor, id: agent.id, patch: { wanted: 'running' } })
  source.homes.set(agent.id, 'MEMORY.md: likes tea')
  const moved = await agentService.update({ actor, id: agent.id, patch: { runsOn: 'cm_targetbx' } })
  assert.equal(moved.runsOn, 'cm_targetbx')
  assert.equal(await runsOn(agent.id), 'cm_targetbx')
  assert.equal(target.homes.get(agent.id), 'MEMORY.md: likes tea')
  assert.equal(target.agentd.applied.get(agent.id), true)
  assert.equal(source.agentd.applied.has(agent.id), false)
})

test('when the copy fails, the agent stays on its computer and runs there again', async () => {
  const agent = await agentService.create({ actor, name: 'Stayer', runsOn: 'cm_sourcebx' })
  await agentService.update({ actor, id: agent.id, patch: { wanted: 'running' } })
  source.homes.set(agent.id, 'MEMORY.md: likes coffee')
  target.broken.unpack = true
  await assert.rejects(agentService.update({ actor, id: agent.id, patch: { runsOn: 'cm_targetbx' } }), { status: 502, message: /stays where it was.*disk full/ })
  assert.equal(await runsOn(agent.id), 'cm_sourcebx')
  assert.equal(source.agentd.applied.get(agent.id), true)
  assert.equal(target.agentd.applied.has(agent.id), false)
  target.broken.unpack = false
})

test('a move to a computer that isn\'t connected is refused before anything stops', async () => {
  const agent = await agentService.create({ actor, name: 'Homebody', runsOn: 'cm_sourcebx' })
  await db.insertInto('computer').values({ id: 'cm_offlinex', name: 'off', token_hash: 'off', expires_at: null }).execute()
  await assert.rejects(agentService.update({ actor, id: agent.id, patch: { runsOn: 'cm_offlinex' } }), { status: 409 })
  assert.equal(await runsOn(agent.id), 'cm_sourcebx')
})
