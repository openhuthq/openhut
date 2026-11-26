import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { agentService } from '../../../src/server/agents/agent-service.ts'
import { runSet } from '../../../src/server/agents/run-set.ts'
import { fakeAgentd, refresh, signIn } from './signed-in.ts'

fakeAgentd()
await migrate()
const person = (id: string, role: 'owner' | 'admin' | 'member') => ({ id, email: `${id}@example.com`, role, removed_at: null })
const owner = person('usr_accowner', 'member')
const picked = person('usr_accpickd', 'member')
const other = person('usr_accother', 'member')
const admin = person('usr_accadmin', 'admin')
await db.insertInto('person').values([person('usr_acctmown', 'owner'), owner, picked, other, admin]).execute()
await db.insertInto('agent').values({ id: 'ag_accesst1', name: 'Pepper', owner_id: owner.id, instructions: '# Pepper', model: 'claude:sonnet', net: 9, channel_key: seal('k'.repeat(32)) }).execute()
signIn({ email: owner.email })
runSet.watch()
await refresh()

const ID = 'ag_accesst1'
const canOpen = async (actor: typeof owner) => (await agentService.list({ actor })).some((agent) => agent.id === ID)
const canChat = (actor: typeof owner) => agentService.requireEditable({ actor, id: ID }).then(() => true, () => false)

test('specific people: the owner, the people picked and admins can list, open and chat; nobody else', async () => {
  await agentService.update({ actor: owner, id: ID, patch: { shared: false, people: [picked.email] } })
  for (const [actor, allowed] of [[owner, true], [picked, true], [admin, true], [other, false]] as const) {
    assert.equal(await canOpen(actor), allowed, actor.email)
    assert.equal(await canChat(actor), allowed, actor.email)
    assert.equal((await agentService.visibleIds({ actor })).has(ID), allowed, actor.email)
    if (allowed) assert.equal((await agentService.get({ actor, id: ID })).id, ID)
    else await assert.rejects(agentService.get({ actor, id: ID }), { status: 404 })
  }
})

test('whole team: every member can open and chat', async () => {
  await agentService.update({ actor: owner, id: ID, patch: { shared: true } })
  assert.equal(await canOpen(other), true)
  assert.equal(await canChat(other), true)
  await agentService.update({ actor: owner, id: ID, patch: { shared: false, people: [] } })
  assert.equal(await canOpen(other), false)
  assert.equal(await canChat(picked), false)
})

test('only the owner changes who has access, and only to people on the team', async () => {
  await assert.rejects(agentService.update({ actor: picked, id: ID, patch: { people: [other.email] } }), { status: 403 })
  await assert.rejects(agentService.update({ actor: owner, id: ID, patch: { people: ['stranger@example.com'] } }), { status: 400 })
})
