import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../src/platform/db.ts'
import { agentd } from '../../src/platform/agentd.ts'
import { seal } from '../../src/platform/secrets.ts'
import { memoryService } from '../../src/agents/memory-service.ts'

await migrate()
await db.insertInto('person').values([
  { id: 'usr_memowner', email: 'memowner@example.com', pass: 'x', role: 'admin', removed_at: null },
  { id: 'usr_memmembr', email: 'memmember@example.com', pass: 'x', role: 'member', removed_at: null },
]).execute()
await db.insertInto('agent').values({ id: 'ag_memorytt', name: 'Ops', owner_id: 'usr_memowner', instructions: '# Ops', model: 'sonnet', net: 11, channel_key: seal('k'.repeat(32)) }).execute()
const owner = { id: 'usr_memowner', email: 'memowner@example.com', role: 'admin' as const }
const member = { id: 'usr_memmembr', email: 'memmember@example.com', role: 'member' as const }
const files: { notes: string | null; people: string | null } = { notes: ' Late means 5 days.\n§\n\nRefunds need David. \n§\n', people: null }
mock.method(agentd, 'ps', async () => ({ states: {} }))
mock.method(agentd, 'memory', async () => ({ ...files }))
const write = mock.method(agentd, 'writeMemory', async ({ target, body }: { target: 'notes' | 'people'; body: string }) => { files[target] = body; return { written: target } })

test('memory splits Hermes\'s files into trimmed entries and reports how much of each limit is used', async () => {
  const memory = await memoryService.get({ actor: member, agentId: 'ag_memorytt' })
  assert.deepEqual(memory.notes, { entries: ['Late means 5 days.', 'Refunds need David.'], used: 40, limit: 2200, saved: true })
  assert.deepEqual(memory.people, { entries: [], used: 0, limit: 1375, saved: false })
})

test('only someone who can change the agent can edit its memory, and it is written back in Hermes\'s format', async () => {
  await assert.rejects(memoryService.update({ actor: member, agentId: 'ag_memorytt', patch: { notes: ['x'] } }), { status: 403 })
  assert.equal(write.mock.callCount(), 0)
  const memory = await memoryService.update({ actor: owner, agentId: 'ag_memorytt', patch: { notes: [' Late means 5 days. ', 'Depot closes at 18:00'] } })
  assert.equal(files.notes, 'Late means 5 days.\n§\nDepot closes at 18:00')
  assert.deepEqual(memory.notes.entries, ['Late means 5 days.', 'Depot closes at 18:00'])
})

test('memory over the limit, a bare § line, or a file the agent never saved is refused', async () => {
  await assert.rejects(memoryService.update({ actor: owner, agentId: 'ag_memorytt', patch: { notes: ['a'.repeat(1200), 'b'.repeat(1200)] } }), { status: 400, message: /over the 2,200 limit/ })
  await assert.rejects(memoryService.update({ actor: owner, agentId: 'ag_memorytt', patch: { notes: ['one\n§\ntwo'] } }), { status: 400 })
  await assert.rejects(memoryService.update({ actor: owner, agentId: 'ag_memorytt', patch: { people: ['Pablo likes short answers'] } }), { status: 409 })
})
