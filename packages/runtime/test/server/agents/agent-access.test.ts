import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { agentService } from '../../../src/server/agents/agent-service.ts'
import { runSet } from '../../../src/server/agents/run-set.ts'
import Fastify from 'fastify'
import { validatorCompiler } from 'fastify-type-provider-zod'
import { answerErrors } from '../../../src/server/platform/http-error.ts'
import { sha } from '../../../src/server/platform/secrets.ts'
import { permissionController } from '../../../src/server/permissions/permission-controller.ts'
import { asks } from '../../../src/core/asks.ts'
import { secretService } from '../../../src/server/agents/secret-service.ts'
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
const canChat = (actor: typeof owner) => agentService.requireUse({ actor, id: ID }).then(() => true, () => false)

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

test('a picked member can chat, but only the owner changes its tools, keys and token, or answers its requests', async () => {
  await agentService.update({ actor: owner, id: ID, patch: { shared: false, people: [picked.email] } })
  assert.equal(await canChat(picked), true)
  const app = Fastify()
  answerErrors(app)
  app.setValidatorCompiler(validatorCompiler)
  await app.register(permissionController, { prefix: '/api/agent-tools' })
  await db.insertInto('session').values({ hash: sha('ohs_pickedsession'), person_id: picked.id, expires_at: new Date(Date.now() + 60_000) }).execute()
  const cookie = 'openhut_session=ohs_pickedsession'
  const patch = await app.inject({ method: 'PATCH', url: '/api/agent-tools', headers: { cookie }, payload: { agentId: ID, connectionId: 'cn_anything', tools: ['git_credentials'], permission: 'allow' } })
  assert.equal(patch.statusCode, 403)
  assert.equal((await app.inject({ method: 'DELETE', url: `/api/agent-tools?agentId=${ID}&connectionId=cn_anything`, headers: { cookie } })).statusCode, 403)
  await app.close()
  const origin = JSON.stringify({ platform: 'slack', chat_id: 'c1' })
  await db.insertInto('ask').values({ id: 'chg_accesst1', agent_id: ID, kind: 'update_self', input: JSON.stringify({ name: 'Salt' }), title: 'Rename to Salt', why: 'x', origin, expires_at: new Date(Date.now() + 60_000) }).execute()
  await assert.rejects(asks.approve({ actor: picked, id: 'chg_accesst1' }), { status: 403 })
  await assert.rejects(asks.decline({ actor: picked, id: 'chg_accesst1' }), { status: 403 })
  assert.equal((await asks.decline({ actor: owner, id: 'chg_accesst1' })).status, 'declined')
  await secretService.save({ agentId: ID, input: { name: 'STRIPE_KEY', hosts: ['api.stripe.com'], header: 'Authorization: Bearer {value}' }, value: 'sk_test_x' })
  const [key] = await secretService.list({ actor: picked, agentId: ID })
  await assert.rejects(secretService.replace({ actor: picked, id: key.id, value: 'sk_test_y' }), { status: 403 })
  await assert.rejects(secretService.delete({ actor: picked, id: key.id }), { status: 403 })
  await assert.rejects(agentService.revokeToken({ actor: picked, id: ID }), { status: 403 })
  await assert.rejects(agentService.revokeToken({ actor: admin, id: ID }), { status: 403 })
  assert.equal((await secretService.delete({ actor: owner, id: key.id })).deleted, true)
  assert.equal((await agentService.revokeToken({ actor: owner, id: ID })).id, ID)
})
