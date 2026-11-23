import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentFacts, allowed, runsOnAllowed, type AgentFacts, type Roster } from '../../src/records/allowed.ts'
import { seal, type KeyUse } from '../../src/records/seal.ts'
import type { Collection, SealedRow } from '../../src/records/wire.ts'
import { keyOf, keysOf, roster, signerOf, team, type Device } from './world.ts'

async function row({ collection = 'message', parent = 'ag_shared1', id = 'row_0000001', by = 'moMac', use = 'workspace', deleted = false }: { collection?: Collection; parent?: string | null; id?: string; by?: Device; use?: KeyUse; deleted?: boolean } = {}): Promise<SealedRow> {
  const where = { collection, workspace: team, parent, id }
  const value = deleted ? null : { [use]: { any: 'thing' } }
  const put = await seal({ where, ver: 1, value, keys: keysOf(by.startsWith('mo') ? 'moMac' : 'anaMac'), signer: signerOf(by) })
  assert.ok(put)
  return { id: where.id, object: collection, ...put, by: keyOf(by) }
}

const shared: AgentFacts = { id: 'ag_shared1', workspace: team, owner: 'mo@example.com', private: false }
const secret: AgentFacts = { ...shared, private: true }
const may = async (input: Parameters<typeof row>[0] & { agent?: AgentFacts; current?: SealedRow | null }) => allowed({ row: await row(input), roster, agent: input.agent ?? shared, current: input.current })
const PER_AGENT = ['message', 'file', 'memory', 'skill', 'routine', 'control', 'channel'] as const

test('only listed, not-removed devices of the row’s workspace may write', async () => {
  assert.equal(await may({ by: 'stranger' }), false)
  assert.equal(await may({ by: 'gone' }), false)
  assert.equal(allowed({ row: await row(), roster: { ...roster, workspace: 'ws_other_001' }, agent: shared }), false)
  assert.equal(await may({ by: 'moMac' }), true)
  assert.equal(await may({ collection: 'skill', by: 'anaMac' }), true)
})

test('a row never moves to another parent, collection or workspace', async () => {
  const current = await row({ collection: 'skill', by: 'anaMac' })
  assert.equal(await may({ collection: 'skill', by: 'anaMac', current }), true)
  assert.equal(allowed({ row: { ...await row({ collection: 'skill', by: 'anaMac' }), parent: 'ag_other01' }, roster, agent: { ...shared, id: 'ag_other01' }, current }), false)
  assert.equal(await may({ collection: 'routine', by: 'anaMac', current }), false)
})

test('viewers write nothing, not even on their own agents', async () => {
  for (const by of ['moPhone', 'anaPhone'] as const) {
    for (const collection of PER_AGENT) assert.equal(await may({ collection, id: 'ag_shared1', by, current: null }), false, `${by} ${collection}`)
    assert.equal(await may({ collection: 'agent', parent: 'mo@example.com', by, current: null }), false)
    assert.equal(await may({ collection: 'connection', parent: null, by, use: 'own', current: null }), false)
  }
})

test('messages, files, control and channels are written only by the agent owner’s Macs and servers', async () => {
  const runner = await row({ by: 'moServer' })
  for (const collection of ['message', 'file', 'control', 'channel'] as const) {
    assert.equal(await may({ collection, id: 'ag_shared1', by: 'moMac' }), true, collection)
    assert.equal(await may({ collection, id: 'ag_shared1', by: 'moServer' }), true, collection)
    assert.equal(await may({ collection, id: 'ag_shared1', by: 'anaMac' }), false, collection)
  }
  assert.equal(await may({ by: 'moMac', current: runner, deleted: true }), true)
  assert.equal(await may({ by: 'anaMac', current: runner, deleted: true }), false)
})

test('memory is written by any member’s Mac or server, whoever wrote it last', async () => {
  const runner = await row({ collection: 'memory', id: 'ag_shared1', by: 'moServer' })
  assert.equal(await may({ collection: 'memory', id: 'ag_shared1', by: 'anaMac', current: runner }), true)
  assert.equal(await may({ collection: 'memory', id: 'ag_shared1', by: 'anaMac', current: null }), true)
})

test('an agent has one control and one memory record, whose id is the agent’s', async () => {
  for (const collection of ['control', 'memory'] as const) {
    assert.equal(await may({ collection, id: 'ag_shared1', by: 'moMac' }), true, collection)
    assert.equal(await may({ collection, id: 'ctl_0000002', by: 'moMac' }), false, collection)
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
  assert.equal(await may({ collection: 'skill', by: 'anaMac', agent: secret }), false)
  assert.equal(await may({ collection: 'memory', id: 'ag_shared1', by: 'anaMac', agent: secret }), false)
  assert.equal(await may({ collection: 'skill', by: 'moMac', agent: secret }), true)
  assert.equal(allowed({ row: await row(), roster, agent: null }), false)
  assert.equal(allowed({ row: await row(), roster, agent: { ...shared, id: 'ag_other01' } }), false)
})

test('a connection lives in its writer’s own team, with no parent, and only its first writer changes it', async () => {
  const connection = (by: Device, extra: { parent?: string } = {}) => row({ collection: 'connection', parent: null, by, use: 'own', ...extra })
  const anaHome: Roster = { ...roster, members: roster.members.map((member) => ({ ...member, role: member.email === 'ana@example.com' ? 'owner' : 'member' })) }
  const current = await connection('moMac')
  assert.equal(allowed({ row: await connection('moServer'), roster, current }), true)
  assert.equal(allowed({ row: await connection('anaMac'), roster, current: null }), false)
  assert.equal(allowed({ row: await connection('anaMac'), roster: anaHome, current: null }), true)
  assert.equal(allowed({ row: await connection('anaMac'), roster: anaHome, current }), false)
  assert.equal(allowed({ row: await connection('moMac', { parent: 'ag_shared1' }), roster, current: null }), false)
})
