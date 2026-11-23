import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentFacts, allowed, runsOnAllowed, type AgentFacts } from '../../src/records/allowed.ts'
import { seal, type KeyUse } from '../../src/records/seal.ts'
import type { Collection, SealedRow } from '../../src/records/wire.ts'
import { keyOf, keysOf, roster, signerOf, team, type Device } from './world.ts'

async function row({ collection = 'message', parent = 'ag_shared1', by = 'moMac', use = 'workspace', deleted = false }: { collection?: Collection; parent?: string | null; by?: Device; use?: KeyUse; deleted?: boolean } = {}): Promise<SealedRow> {
  const where = { collection, workspace: team, parent, id: 'row_0000001' }
  const value = deleted ? null : { [use]: { any: 'thing' } }
  const put = await seal({ where, ver: 1, value, keys: keysOf(by.startsWith('mo') ? 'moMac' : 'anaMac'), signer: signerOf(by) })
  assert.ok(put)
  return { id: where.id, object: collection, ...put, by: keyOf(by) }
}

const shared: AgentFacts = { id: 'ag_shared1', workspace: team, owner: 'mo@example.com', private: false }
const secret: AgentFacts = { ...shared, private: true }
const may = async (input: Parameters<typeof row>[0] & { agent?: AgentFacts; current?: SealedRow | null }) => allowed({ row: await row(input), roster, agent: input.agent ?? shared, current: input.current })

test('only listed, not-removed devices of the row’s workspace may write', async () => {
  assert.equal(await may({ by: 'stranger' }), false)
  assert.equal(await may({ by: 'gone' }), false)
  assert.equal(allowed({ row: await row(), roster: { ...roster, workspace: 'ws_other_001' }, agent: shared }), false)
  assert.equal(await may({ by: 'anaMac' }), true)
})

test('a row never moves to another parent, collection or workspace', async () => {
  const current = await row({ by: 'anaMac' })
  assert.equal(await may({ by: 'anaMac', current }), true)
  assert.equal(allowed({ row: { ...await row({ by: 'anaMac' }), parent: 'ag_other01' }, roster, agent: { ...shared, id: 'ag_other01' }, current }), false)
  assert.equal(await may({ collection: 'memory', by: 'anaMac', current }), false)
})

test('viewers write messages, files and memory, and only their own or on their own agents', async () => {
  const anaMessage = await row({ by: 'anaMac' })
  const runnerMessage = await row({ by: 'moServer' })
  const runnerMemory = await row({ collection: 'memory', by: 'moServer' })
  assert.equal(await may({ by: 'anaPhone', current: null }), true)
  assert.equal(await may({ by: 'anaPhone', current: anaMessage }), true)
  assert.equal(await may({ by: 'anaPhone', current: runnerMessage }), false)
  assert.equal(await may({ by: 'anaPhone', current: runnerMessage, deleted: true }), false)
  assert.equal(await may({ by: 'moPhone', current: runnerMessage, deleted: true }), true)
  assert.equal(await may({ collection: 'file', by: 'anaPhone', current: null }), true)
  assert.equal(await may({ collection: 'memory', by: 'moPhone', current: runnerMemory }), true)
  assert.equal(await may({ collection: 'memory', by: 'anaPhone', current: runnerMemory }), false)
  assert.equal(await may({ collection: 'memory', by: 'anaMac', current: runnerMemory }), true)
  for (const collection of ['skill', 'routine', 'control', 'channel'] as const) assert.equal(await may({ collection, by: 'moPhone', current: null }), false, collection)
  assert.equal(await may({ collection: 'agent', parent: 'mo@example.com', by: 'moPhone', current: null }), false)
  assert.equal(await may({ collection: 'connection', parent: null, by: 'moPhone', use: 'own', current: null }), false)
})

test('a message changes only by whoever wrote it or the agent’s owner, from any device class', async () => {
  const anaMessage = await row({ by: 'anaMac' })
  assert.equal(await may({ by: 'moServer', current: anaMessage }), true)
  assert.equal(await may({ by: 'anaMac', current: await row({ by: 'moServer' }) }), false)
})

test('control and channels are signed only by the agent owner’s Macs and servers', async () => {
  for (const collection of ['control', 'channel'] as const) {
    assert.equal(await may({ collection, by: 'moMac' }), true)
    assert.equal(await may({ collection, by: 'moServer' }), true)
    assert.equal(await may({ collection, by: 'moPhone' }), false)
    assert.equal(await may({ collection, by: 'anaMac' }), false)
  }
})

test('runsOn names only the owner’s Macs and servers', () => {
  assert.equal(runsOnAllowed({ roster, agent: shared, runsOn: keyOf('moServer') }), true)
  assert.equal(runsOnAllowed({ roster, agent: shared, runsOn: keyOf('moMac') }), true)
  assert.equal(runsOnAllowed({ roster, agent: shared, runsOn: keyOf('moPhone') }), false)
  assert.equal(runsOnAllowed({ roster, agent: shared, runsOn: keyOf('anaMac') }), false)
  assert.equal(runsOnAllowed({ roster, agent: shared, runsOn: keyOf('gone') }), false)
})

test('an agent is created by its owner, edited by teammates while shared, and deleted by its owner or an admin', async () => {
  const agent = (by: Device, extra: { use?: KeyUse; deleted?: boolean; parent?: string } = {}) => row({ collection: 'agent', parent: 'mo@example.com', by, ...extra })
  const current = await agent('moMac')
  const privately = await agent('moMac', { use: 'own' })
  assert.equal(allowed({ row: await agent('moMac'), roster, current: null }), true)
  assert.equal(allowed({ row: await agent('anaMac'), roster, current: null }), false)
  assert.equal(allowed({ row: await agent('anaMac'), roster, current }), true)
  assert.equal(allowed({ row: await agent('anaMac'), roster }), true)
  assert.equal(allowed({ row: await agent('anaMac', { use: 'own' }), roster, current }), false)
  assert.equal(allowed({ row: await agent('anaMac'), roster, current: privately }), false)
  assert.equal(allowed({ row: await agent('anaMac', { deleted: true }), roster, current }), false)
  assert.equal(allowed({ row: await agent('moMac', { deleted: true }), roster, current }), true)
  assert.equal(allowed({ row: { ...await agent('moMac'), parent: 'ana@example.com' }, roster, current }), false)
  assert.equal(allowed({ row: await agent('anaMac', { deleted: true }), roster: { ...roster, members: roster.members.map((member) => ({ ...member, role: member.role === 'member' ? 'admin' : member.role })) }, current }), true)
  assert.deepEqual(agentFacts({ ...privately, id: 'ag_private' }), { id: 'ag_private', workspace: team, owner: 'mo@example.com', private: true })
})

test('a private agent’s rows are written only by its owner’s devices', async () => {
  assert.equal(await may({ by: 'anaMac', agent: secret, current: null }), false)
  assert.equal(await may({ collection: 'skill', by: 'anaMac', agent: secret }), false)
  assert.equal(await may({ by: 'moPhone', agent: secret, current: null }), true)
  assert.equal(allowed({ row: await row({ by: 'anaMac' }), roster, agent: null }), false)
  assert.equal(allowed({ row: await row({ by: 'anaMac' }), roster, agent: { ...shared, id: 'ag_other01' } }), false)
})

test('a connection is written by its owner’s Macs and servers only, with no parent', async () => {
  const current = await row({ collection: 'connection', parent: null, by: 'moMac', use: 'own' })
  assert.equal(await may({ collection: 'connection', parent: null, by: 'moServer', use: 'own', current }), true)
  assert.equal(await may({ collection: 'connection', parent: null, by: 'anaMac', use: 'own', current }), false)
  assert.equal(await may({ collection: 'connection', parent: 'ag_shared1', by: 'moMac', use: 'own', current: null }), false)
})
