import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { agentd } from '../../../src/server/platform/agentd.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { runSet } from '../../../src/server/agents/run-set.ts'
import { refresh, signIn } from './signed-in.ts'
import { skillService } from '../../../src/server/agents/skill-service.ts'

await migrate()
await db.insertInto('person').values([
  { id: 'usr_skillown', email: 'skillowner@example.com', role: 'admin', removed_at: null },
  { id: 'usr_skillmem', email: 'skillmember@example.com', role: 'member', removed_at: null },
]).execute()
await db.insertInto('agent').values({ id: 'ag_skilltst', name: 'Dev', owner_id: 'usr_skillown', instructions: '# Dev', model: 'claude:sonnet', net: 9, channel_key: seal('k'.repeat(32)) }).execute()
const owner = { id: 'usr_skillown', email: 'skillowner@example.com', local: false, role: 'admin' as const }
const member = { id: 'usr_skillmem', email: 'skillmember@example.com', local: false, role: 'member' as const }
const files: Record<string, string> = {
  'research/arxiv': '---\nname: arxiv\ndescription: "Search arXiv."\n---\nBody\n',
  'late-invoices': '---\ndescription: Chase late invoices.\n---\nSteps\n',
}
mock.method(agentd, 'ps', async () => ({ states: {} }))
mock.method(agentd, 'apply', async ({ id }: { id: string }) => ({ applied: id, change: 'none' as const }))
mock.method(agentd, 'skills', async () => ({ skills: Object.entries(files).map(([path, head]) => ({ path, head })), bundled: 'arxiv:abc\n' }))
const skillOf = (path: string) => path.slice('skills/'.length, -'/SKILL.md'.length)
mock.method(agentd, 'read', async ({ path }: { path: string }) => (files[skillOf(path)] === undefined ? null : Buffer.from(files[skillOf(path)])))
const write = mock.method(agentd, 'write', async ({ path, body }: { path: string; body: Buffer | string }) => { files[skillOf(path)] = String(body); return { path } })

signIn({ email: 'skillowner@example.com' })
await refresh()

test('skills an agent learned come first; names and descriptions come from the front matter or the folder', async () => {
  const skills = await skillService.list({ actor: member, agentId: 'ag_skilltst' })
  assert.deepEqual(skills.map(({ id, name, description, builtIn, body }) => ({ id, name, description, builtIn, body })), [
    { id: 'ag_skilltst~late-invoices', name: 'late-invoices', description: 'Chase late invoices.', builtIn: false, body: null },
    { id: 'ag_skilltst~research~arxiv', name: 'arxiv', description: 'Search arXiv.', builtIn: true, body: null },
  ])
})

test('opening a skill returns its text; an unknown or malformed id is a 404', async () => {
  assert.equal((await skillService.get({ actor: member, id: 'ag_skilltst~research~arxiv' })).body, files['research/arxiv'])
  await assert.rejects(skillService.get({ actor: member, id: 'ag_skilltst~nope' }), { status: 404 })
  await assert.rejects(skillService.get({ actor: member, id: 'ag_skilltst~..~..~etc' }), { status: 404 })
})

test('only someone who can change the agent can save a skill', async () => {
  await assert.rejects(skillService.update({ actor: member, id: 'ag_skilltst~late-invoices', patch: { body: 'x' } }), { status: 403 })
  assert.equal(write.mock.callCount(), 0)
  assert.equal((await skillService.update({ actor: owner, id: 'ag_skilltst~late-invoices', patch: { body: 'New steps\n' } })).body, 'New steps\n')
})

test('a learned skill can be deleted by someone who can change the agent; a built-in one never', async () => {
  const remove = mock.method(agentd, 'delete', async ({ paths }: { paths: string[] }) => { for (const path of paths) delete files[path.slice('skills/'.length)]; return { removed: paths } })
  await assert.rejects(skillService.delete({ actor: member, id: 'ag_skilltst~late-invoices' }), { status: 403 })
  await assert.rejects(skillService.delete({ actor: owner, id: 'ag_skilltst~research~arxiv' }), { status: 400 })
  assert.equal(remove.mock.callCount(), 0)
  assert.deepEqual(await skillService.delete({ actor: owner, id: 'ag_skilltst~late-invoices' }), { id: 'ag_skilltst~late-invoices', object: 'skill', deleted: true })
  assert.deepEqual(remove.mock.calls[0].arguments[0], { id: 'ag_skilltst', paths: ['skills/late-invoices'] })
})
