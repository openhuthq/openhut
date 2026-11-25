import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { agentToken, seal } from '../../../src/server/platform/secrets.ts'
import { agentService } from '../../../src/server/agents/agent-service.ts'
import { recordsService } from '../../../src/server/platform/records.ts'
import { runSet } from '../../../src/server/agents/run-set.ts'
import { HttpError } from '../../../src/server/platform/http-error.ts'
import { settings } from '../../../src/server/platform/settings.ts'
import { fakeAgentd, HOME, refresh, signIn } from './signed-in.ts'

const agentd = fakeAgentd()
await migrate()
await db.insertInto('person').values({ id: 'usr_tokenown', email: 'tokenowner@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_tokentst', name: 'Dev', owner_id: 'usr_tokenown', instructions: '# Dev', model: 'claude:sonnet', net: 7, channel_key: seal('k'.repeat(32)) }).execute()
await db.insertInto('channel').values({ id: 'ch_tokentst', agent_id: 'ag_tokentst', kind: 'telegram', status: 'connected', account: '@dev_bot', owner_address: '15550001111', open: false, allowed: '', secrets: seal(JSON.stringify({ botToken: '123:abc' })) }).execute()
const { fake, device } = signIn({ email: 'tokenowner@example.com' })
runSet.watch()
await refresh()
const token = agentToken({ id: 'ag_tokentst', epoch: 0 })

test('an agent\'s own token is the whole check, from any address; a forged one is refused', async () => {
  assert.equal((await agentService.byToken({ token }))?.id, 'ag_tokentst')
  const forged = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`
  assert.equal(await agentService.byToken({ token: forged }), undefined)
  assert.equal(await agentService.byToken({ token: `ag_missing0.${token.split('.')[1]}` }), undefined)
})

test('revoking an agent\'s token refuses the old one at once; the new one works', async () => {
  const actor = { id: 'usr_tokenown', email: 'tokenowner@example.com', role: 'owner' as const }
  await agentService.revokeToken({ actor, id: 'ag_tokentst' })
  assert.equal(await agentService.byToken({ token }), undefined)
  assert.equal((await agentService.byToken({ token: agentToken({ id: 'ag_tokentst', epoch: 1 }) }))?.id, 'ag_tokentst')
})

test('renaming an agent cleans the name and refuses an empty one', async () => {
  const actor = { id: 'usr_tokenown', email: 'tokenowner@example.com', role: 'owner' as const }
  assert.equal((await agentService.update({ actor, id: 'ag_tokentst', patch: { name: '  Sales <b>bot</b> ' } })).name, 'Sales bbotb')
  await assert.rejects(agentService.update({ actor, id: 'ag_tokentst', patch: { name: '<>' } }), { status: 400 })
})

test('an agent carries its model’s display name from this computer’s catalogue, so teammates see Sonnet 5.5, not sonnet', async () => {
  const actor = { id: 'usr_tokenown', email: 'tokenowner@example.com', role: 'owner' as const }
  const agent = await agentService.get({ actor, id: 'ag_tokentst' })
  assert.equal(agent.model, 'claude:sonnet')
  assert.equal(agent.modelName, 'Sonnet 5.5')
})

test('an agent keeps the face it was given, so every device shows the same one', async () => {
  const actor = { id: 'usr_tokenown', email: 'tokenowner@example.com', role: 'owner' as const }
  assert.equal((await agentService.get({ actor, id: 'ag_tokentst' })).face, null)
  const face = JSON.stringify({ seed: 'face_1', body: 2 })
  assert.equal((await agentService.update({ actor, id: 'ag_tokentst', patch: { face } })).face, face)
  assert.equal((await agentService.get({ actor, id: 'ag_tokentst' })).face, face)
})

test('model choices: only a connected, switched-on model is accepted', async () => {
  const actor = { id: 'usr_tokenown', email: 'tokenowner@example.com', role: 'owner' as const }
  const model = (id: string, on: boolean) => ({ id, name: id, on, tier: 'big' as const, note: null, contextLength: null, inputPrice: null, outputPrice: null })
  await settings.setProviderKey('openai', 'sk-test-key-for-choices')
  await settings.setCatalog('openai', { at: new Date().toISOString(), models: [model('gpt-5.5', true), model('gpt-5.5-mini', true), model('o5', false)] })
  const id = 'ag_tokentst'
  await assert.rejects(agentService.update({ actor, id, patch: { model: 'compatible:grok-5' } }), { status: 409, param: 'model', message: /isn't connected on this computer/ })
  await assert.rejects(agentService.update({ actor, id, patch: { model: 'openai:o5' } }), { status: 409, message: /switched off/ })
  const picked = await agentService.update({ actor, id, patch: { model: 'openai:gpt-5.5' } })
  assert.equal(picked.model, 'openai:gpt-5.5')
})

test('a computer without agent-browser refuses the browser switch before changing anything', async () => {
  const actor = { id: 'usr_tokenown', email: 'tokenowner@example.com', role: 'owner' as const }
  await assert.rejects(agentService.update({ actor, id: 'ag_tokentst', patch: { browser: true } }), { status: 409, param: 'browser' })
  assert.equal((await db.selectFrom('agent').select('web_browser').where('id', '=', 'ag_tokentst').executeTakeFirstOrThrow()).web_browser, false)
})

const owner = { id: 'usr_tokenown', email: 'tokenowner@example.com', role: 'owner' as const }
const mate = { id: 'usr_teammate', email: 'teammate@example.com', role: 'owner' as const }

test('a new agent is two records, runs here, and only its owner changes it, even shared: a teammate chats', async () => {
  const made = await agentService.create({ actor: owner, name: 'Juniper' })
  assert.deepEqual([made.runsHere, made.owner, made.shared], [true, 'tokenowner@example.com', false])
  assert.ok(await db.selectFrom('agent').select('id').where('id', '=', made.id).executeTakeFirst())
  await assert.rejects(agentService.update({ actor: mate, id: made.id, patch: { model: 'claude:opus' } }), { status: 403 })
  await assert.rejects(agentService.update({ actor: owner, id: made.id, patch: { runsOn: 'dev_mate' } }), { status: 400, param: 'runsOn' })
  await agentService.update({ actor: owner, id: made.id, patch: { shared: true } })
  await assert.rejects(agentService.update({ actor: mate, id: made.id, patch: { name: 'June' } }), { status: 403 })
  assert.equal((await agentService.update({ actor: owner, id: made.id, patch: { name: 'June' } })).name, 'June')
  await assert.rejects(agentService.createGrant({ actor: mate, agentId: made.id, connectionId: 'cn_none' }), { status: 403 })
})

test('a new agent can be shared with the team as it is made', async () => {
  const made = await agentService.create({ actor: owner, name: 'Pepper', shared: true })
  assert.equal(made.shared, true)
  assert.equal((await agentService.update({ actor: mate, id: made.id, patch: { name: 'Pep' } }).catch((error: { status: number }) => error.status)), 403)
})

test('a new agent has Browser on when this computer can run one', async () => {
  agentd.features.browser = true
  assert.equal((await agentService.create({ actor: owner, name: 'Scout' })).browser, true)
  agentd.features.browser = false
})

test('a deleted agent leaves this computer and its records', async () => {
  const made = await agentService.create({ actor: owner, name: 'Brief' })
  await agentService.delete({ actor: owner, id: made.id })
  assert.equal(await db.selectFrom('agent').select('id').where('id', '=', made.id).executeTakeFirst(), undefined)
  assert.equal((await recordsService.get({ collection: 'agent', workspace: HOME, id: made.id }))?.deleted, true)
})

test('an agent this computer couldn\'t set up says so as its health, with the reason, until a later try works', async () => {
  const made = await agentService.create({ actor: owner, name: 'Netless' })
  await agentService.update({ actor: owner, id: made.id, patch: { wanted: 'running' } })
  agentd.failing.add(made.id)
  await assert.rejects(agentService.reapply({ id: made.id }))
  const failed = await agentService.get({ actor: owner, id: made.id })
  assert.equal(failed.health, 'setup_failed')
  assert.match(failed.healthDetail, /Pool overlaps/)
  assert.equal((await agentService.statuses({ workspace: HOME }))[made.id]?.health, 'not_answering')
  agentd.failing.delete(made.id)
  await agentService.reapply({ id: made.id })
  assert.notEqual((await agentService.get({ actor: owner, id: made.id })).health, 'setup_failed')
})

test('on boot, a sandbox left by an earlier install for an agent this computer doesn’t run is removed', async () => {
  agentd.applied.set('ag_stray0001', false)
  await agentService.boot()
  assert.equal(agentd.applied.has('ag_stray0001'), false)
  assert.equal(agentd.applied.has('ag_tokentst'), true)
})
