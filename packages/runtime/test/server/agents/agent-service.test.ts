import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { sql } from 'kysely'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { agentToken, openSealed, seal, sealFor, transferPublicKey, unseal } from '../../../src/server/platform/secrets.ts'
import { agentService } from '../../../src/server/agents/agent-service.ts'

const homes = new Map<string, string>()
const agentd = createServer({ allowHalfOpen: true }, (sock) => {
  let raw = ''
  sock.setEncoding('utf8').on('data', (chunk) => { raw += chunk }).on('end', () => {
    const [line = '', rest = ''] = raw.split(/\n([\s\S]*)/)
    const req = JSON.parse(line)
    if (req.cmd === 'home-import') homes.set(req.id, rest)
    const replies: Record<string, unknown> = {
      ps: { states: {} }, health: { firewall: true, imageReady: true }, 'home-export': { tar: homes.get(req.id) ?? '' }, 'home-import': { imported: req.id },
      create: { container: `ag-${req.id}` }, apply: { applied: req.id, restarted: false }, rm: { removed: req.id },
    }
    sock.end(JSON.stringify({ ok: true, ...(replies[req.cmd] as object) }))
  })
}).listen(process.env.AGENTD_SOCK)
agentd.unref()

await migrate()
await db.insertInto('person').values({ id: 'usr_tokenown', email: 'tokenowner@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_tokentst', name: 'Dev', owner_id: 'usr_tokenown', instructions: '# Dev', model: 'sonnet', net: 7, channel_key: seal('k'.repeat(32)) }).execute()
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

test('the browser is off for every agent, even on a database that kept the old browser column that defaulted to on', async () => {
  await sql`alter table agent add column if not exists browser boolean not null default true`.execute(db)
  await migrate()
  const actor = { id: 'usr_tokenown', email: 'tokenowner@example.com', role: 'owner' as const }
  assert.equal((await agentService.get({ actor, id: 'ag_tokentst' })).browser, false)
})

test('an agent moves sealed with its channels, chats, home and the grants this computer can give; Codex is refused', async () => {
  const actor = { id: 'usr_tokenown', email: 'tokenowner@example.com' }
  const id = 'ag_movetest'
  await db.insertInto('agent').values({ id, name: 'Mover', owner_id: actor.id, instructions: '# Mover', model: 'haiku', net: 9, channel_key: seal('k'.repeat(32)) }).execute()
  await db.insertInto('channel').values({ id: 'ch_movetest', agent_id: id, kind: 'slack', status: 'connected', account: 'Acme', owner_address: '', open: false, allowed: '', secrets: seal(JSON.stringify({ botToken: 'xoxb-1', appToken: 'xapp-1' })) }).execute()
  await db.insertInto('thread').values({ id: 'th_movetest', agent_id: id, person_id: actor.id, title: 'Mover', messages: '[{"id":"m1","role":"user","parts":[{"type":"text","text":"hi"}]}]' }).execute()
  await db.insertInto('connection').values([{ id: 'cn_ordersdb', kind: 'postgres', name: 'Orders DB', owner_id: actor.id, config: seal('{}') }, { id: 'cn_githubxx', kind: 'github', name: 'GitHub', owner_id: actor.id, config: seal('{}') }]).execute()
  await db.insertInto('connection_grant').values([{ id: 'gr_ordersdb', agent_id: id, connection_id: 'cn_ordersdb' }, { id: 'gr_githubxx', agent_id: id, connection_id: 'cn_githubxx' }]).execute()
  homes.set(id, 'SOME-TAR')

  await assert.rejects(agentService.update({ actor, id, patch: { model: 'codex' } }), { status: 409, message: 'Codex is coming soon.' })
  await assert.rejects(agentService.exportSealed({ actor, id, publicKey: 'nope' }), { status: 400 })
  const { sealed } = await agentService.exportSealed({ actor, id, publicKey: transferPublicKey })
  assert.ok(!sealed.includes('xoxb') && !sealed.includes('Mover'), 'the bundle is sealed')
  await assert.rejects(agentService.importSealed({ actor, sealed }), { status: 409, message: /already on this computer/ })
  await agentService.delete({ actor, id })
  homes.delete(id)
  await db.deleteFrom('connection').where('id', '=', 'cn_githubxx').execute()

  const bundle = JSON.parse(openSealed(sealed))
  const older = sealFor({ publicKey: transferPublicKey, text: JSON.stringify({ ...bundle, agent: { ...bundle.agent, size: 'large' } }) })
  const moved = await agentService.importSealed({ actor, sealed: older })
  assert.deepEqual([moved.agent.id, moved.agent.name, moved.agent.model, moved.agent.wanted], [id, 'Mover', 'haiku', 'stopped'])
  assert.equal('size' in moved.agent, false)
  assert.deepEqual(moved.ungranted, ['GitHub'])
  assert.equal(homes.get(id), 'SOME-TAR')
  assert.deepEqual((await agentService.listGrants({ agentId: id })).map((grant) => grant.connectionId), ['cn_ordersdb'])
  const channel = await db.selectFrom('channel').selectAll().where('agent_id', '=', id).executeTakeFirstOrThrow()
  assert.deepEqual([channel.kind, channel.account, JSON.parse(unseal(channel.secrets)).botToken], ['slack', 'Acme', 'xoxb-1'])
  const thread = await db.selectFrom('thread').selectAll().where('agent_id', '=', id).executeTakeFirstOrThrow()
  assert.match(thread.messages, /"hi"/)

  await db.updateTable('agent').set({ model: 'codex' }).where('id', '=', id).execute()
  const codex = await agentService.exportSealed({ actor, id, publicKey: transferPublicKey })
  await agentService.delete({ actor, id })
  await assert.rejects(agentService.importSealed({ actor, sealed: codex.sealed }), { status: 409, message: 'Codex is coming soon.' })
})
