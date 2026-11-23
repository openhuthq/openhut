import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentFacts, allowed, runsOnAllowed, type AgentFacts, type Mode, type Roster } from '../../src/records/allowed.ts'
import { seal, type KeyUse } from '../../src/records/seal.ts'
import { COLLECTIONS, type Collection, type SealedRow } from '../../src/records/wire.ts'
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
const judge = (input: Omit<Parameters<typeof allowed>[0], 'mode'> & { mode?: Mode }) => allowed({ mode: 'write', ...input })
const may = async (input: Parameters<typeof row>[0] & { agent?: AgentFacts; current?: SealedRow | null; mode?: Mode }) => judge({ row: await row(input), roster, mode: input.mode, agent: input.agent ?? shared, current: input.current })
const withRole = (email: string, role: 'owner' | 'admin' | 'member'): Roster => ({ ...roster, members: roster.members.map((member) => (member.email === email ? { ...member, role } : member)) })

test('only listed, current devices of the row’s workspace may write', async () => {
  assert.equal(await may({ by: 'stranger' }), false)
  assert.equal(await may({ by: 'gone' }), false)
  assert.equal(judge({ row: await row(), roster: { ...roster, workspace: 'ws_other_001' }, agent: shared }), false)
  assert.equal(await may({ by: 'moMac' }), true)
  assert.equal(await may({ collection: 'skill', by: 'anaMac' }), true)
})

test('a row never moves to another parent, collection or workspace', async () => {
  const current = await row({ collection: 'skill', by: 'anaMac' })
  assert.equal(await may({ collection: 'skill', by: 'anaMac', current }), true)
  assert.equal(judge({ row: { ...await row({ collection: 'skill', by: 'anaMac' }), parent: 'ag_other01' }, roster, agent: { ...shared, id: 'ag_other01' }, current }), false)
  assert.equal(await may({ collection: 'routine', by: 'anaMac', current }), false)
})

test('a removed device’s rows still read as its person’s, but it writes nothing new', async () => {
  assert.equal(await may({ by: 'gone', mode: 'read' }), true)
  assert.equal(await may({ collection: 'control', id: 'ag_shared1', by: 'gone', mode: 'read' }), true)
  assert.equal(await may({ by: 'gone', mode: 'read', agent: { ...shared, owner: 'ana@example.com' } }), false)
  assert.equal(await may({ by: 'stranger', mode: 'read' }), false)
  assert.equal(await may({ collection: 'control', id: 'ag_shared1', by: 'gone' }), false)
  assert.equal(judge({ row: await row({ by: 'gone' }), roster: { ...roster, former: [] }, mode: 'read', agent: shared }), false)
})

test('viewers write no record in any collection, not even on their own agents', async () => {
  const placed: Partial<Record<Collection, { parent: string | null; id?: string }>> = { agent: { parent: 'mo@example.com' }, connection: { parent: null }, workspace: { parent: null, id: team } }
  for (const collection of COLLECTIONS) {
    const where = { collection, id: 'ag_shared1', ...placed[collection], current: null }
    assert.equal(await may({ ...where, by: 'moMac' }), true, collection)
    for (const by of ['moPhone', 'anaPhone'] as const) {
      for (const mode of ['read', 'write'] as const) assert.equal(await may({ ...where, by, mode }), false, `${by} ${collection} ${mode}`)
    }
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
  assert.equal(judge({ row: await agent('moMac'), roster, current: null }), true)
  assert.equal(judge({ row: await agent('anaMac'), roster, current: null }), false)
  assert.equal(judge({ row: await agent('anaMac'), roster, current }), true)
  assert.equal(judge({ row: await agent('anaMac'), roster }), true)
  assert.equal(judge({ row: await agent('anaMac', { use: 'own' }), roster, current }), false)
  assert.equal(judge({ row: await agent('anaMac'), roster, current: privately }), false)
  assert.equal(judge({ row: await agent('anaMac', { deleted: true }), roster, current }), false)
  assert.equal(judge({ row: await agent('moMac', { deleted: true }), roster, current }), true)
  assert.equal(judge({ row: { ...await agent('moMac'), parent: 'ana@example.com' }, roster, current }), false)
  assert.equal(judge({ row: await agent('anaMac', { deleted: true }), roster: withRole('ana@example.com', 'admin'), current }), true)
  assert.deepEqual(agentFacts({ ...privately, id: 'ag_private' }), { id: 'ag_private', workspace: team, owner: 'mo@example.com', private: true })
})

test('a private agent’s rows are written only by its owner’s devices', async () => {
  assert.equal(await may({ collection: 'skill', by: 'anaMac', agent: secret }), false)
  assert.equal(await may({ collection: 'memory', id: 'ag_shared1', by: 'anaMac', agent: secret }), false)
  assert.equal(await may({ collection: 'skill', by: 'moMac', agent: secret }), true)
  assert.equal(judge({ row: await row(), roster, agent: null }), false)
  assert.equal(judge({ row: await row(), roster, agent: { ...shared, id: 'ag_other01' } }), false)
})

test('a connection lives in its writer’s own team, with no parent, and any of the team owner’s Macs or servers changes it', async () => {
  const connection = (by: Device, extra: { parent?: string } = {}) => row({ collection: 'connection', parent: null, by, use: 'own', ...extra })
  const anaHome = withRole('ana@example.com', 'owner')
  const current = await connection('moMac')
  assert.equal(judge({ row: await connection('moServer'), roster, current }), true)
  assert.equal(judge({ row: await connection('moMac'), roster, current: await connection('gone') }), true)
  assert.equal(judge({ row: await connection('anaMac'), roster, current: null }), false)
  assert.equal(judge({ row: await connection('anaMac'), roster: anaHome, current: null }), true)
  assert.equal(judge({ row: await connection('anaMac'), roster: anaHome, current }), true)
  assert.equal(judge({ row: await connection('moMac', { parent: 'ag_shared1' }), roster, current: null }), false)
})

test('the workspace record has the team’s id and no parent, and only an owner’s or admin’s Macs and servers write it', async () => {
  const settings = (by: Device, extra: { parent?: string; id?: string } = {}) => row({ collection: 'workspace', parent: null, id: team, by, ...extra })
  const admin = withRole('ana@example.com', 'admin')
  assert.equal(judge({ row: await settings('anaMac'), roster: admin }), true)
  assert.equal(judge({ row: await settings('moServer'), roster }), true)
  assert.equal(judge({ row: await settings('anaMac'), roster }), false)
  assert.equal(judge({ row: await settings('anaPhone'), roster: admin }), false)
  assert.equal(judge({ row: await settings('moMac', { id: 'ws_other_001' }), roster }), false)
  assert.equal(judge({ row: await settings('moMac', { parent: 'ag_shared1' }), roster }), false)
})
