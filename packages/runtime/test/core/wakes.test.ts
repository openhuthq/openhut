import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { wakes } from '../../src/core/wakes.ts'
import { asks } from '../../src/core/asks.ts'
import { gatewayServer } from '../../src/server/gateway/gateway-server.ts'
import { inboxService } from '../../src/server/inbox/inbox-service.ts'
import { routineService } from '../../src/server/inbox/routines.ts'
import { db, migrate } from '../../src/server/platform/db.ts'
import { log } from '../../src/server/platform/events.ts'
import { agentToken, seal } from '../../src/server/platform/secrets.ts'
import { fakeAgentd, refresh, signIn } from '../server/agents/signed-in.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_wakeownr', email: 'wakes@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_wakeagnt', name: 'Dev', owner_id: 'usr_wakeownr', instructions: '#', model: 'claude:sonnet', net: 93, channel_key: seal('k'.repeat(48)), wanted: 'running' }).execute()
await db.insertInto('channel').values({ id: 'ch_wakewhat', agent_id: 'ag_wakeagnt', kind: 'whatsapp', status: 'connected', account: null, owner_address: '15550004444', open: true, allowed: '', secrets: '' }).execute()
fakeAgentd()
signIn({ email: 'wakes@example.com' })
await refresh()
const owner = { id: 'usr_wakeownr', email: 'wakes@example.com', role: 'owner' as const }
const whatsapp = { platform: 'whatsapp', chat_id: '15550004444@s.whatsapp.net', chat_type: 'dm' }
const app = { platform: 'api_server', chat_id: 'openhut-msg_wakechat' }
const nudged: string[] = []
wakes.onNudge((agentId) => nudged.push(agentId))
const server = gatewayServer.create().listen(0, '127.0.0.1')
await new Promise((resolve) => server.once('listening', resolve))
const headers = { authorization: `Agent ${agentToken({ id: 'ag_wakeagnt', epoch: 0 })}`, 'content-type': 'application/json' }
const url = (path: string) => `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`
test.after(() => server.close())

test('every plugin\'s due wakes come back as one list, each named and prefixed [OpenHut <plugin>:<id>]', async () => {
  const fromApp = /ask_[a-z0-9]+/.exec(await asks.create({ agentId: 'ag_wakeagnt', kind: 'update_self', input: { name: 'Ops' }, description: 'Needed for the job', origin: app }))?.[0] ?? ''
  const fromWhatsApp = /ask_[a-z0-9]+/.exec(await asks.create({ agentId: 'ag_wakeagnt', kind: 'update_self', input: { name: 'Op' }, description: 'Needed for the job', origin: whatsapp }))?.[0] ?? ''
  nudged.length = 0
  await asks.decline({ actor: owner, id: fromApp })
  await asks.decline({ actor: owner, id: fromWhatsApp })
  assert.deepEqual(nudged, ['ag_wakeagnt'], 'only an app-origin decision nudges the app chat')
  const routine = /rt_[a-z0-9]+/.exec(await routineService.schedule({ agentId: 'ag_wakeagnt', input: { name: 'Chase Acme', plan: 'Nudge.', cron: '0 9 * * *', origin: whatsapp } }))?.[0] ?? ''
  await db.updateTable('inbox_source').set({ next_run_at: new Date(Date.now() - 60_000) }).where('id', '=', routine).execute()
  await inboxService.tick()
  const due = await wakes.due({ agentId: 'ag_wakeagnt' })
  assert.deepEqual(due.map((wake) => wake.id.replace(/_[a-z0-9]+$/, '_*')).sort(), ['asks:wk_*', 'asks:wk_*', 'inbox:ru_*'])
  for (const wake of due) assert.ok(wake.text.startsWith(`[OpenHut ${wake.id}] `), wake.text)
  assert.ok(!due.some((wake) => /\[OpenHut ask_|\[Routine /.test(wake.text)), 'no second, older prefix')
  assert.deepEqual(due.filter((wake) => wake.id.startsWith('asks:')).map((wake) => wake.origin.platform).sort(), ['api_server', 'whatsapp'])

  const listed = await (await fetch(url('/wakes'), { headers })).json() as { data: { id: string }[] }
  assert.deepEqual(listed.data.map((wake) => wake.id).sort(), due.filter((wake) => wake.origin.platform !== 'api_server').map((wake) => wake.id).sort(), 'the Hermes plugin never gets the app\'s wakes')
})

test('a report goes to the plugin named in the wake id', async () => {
  const run = (await wakes.due({ agentId: 'ag_wakeagnt' })).find((wake) => wake.id.startsWith('inbox:'))
  assert.ok(run)
  const report = (body: unknown, id = run.id) => fetch(url(`/wakes/${id}`), { method: 'POST', headers, body: JSON.stringify(body) })
  assert.equal((await report({})).status, 400)
  assert.equal((await report({ picked: true }, 'nobody:ru_x')).status, 404)
  assert.equal((await report({ picked: true }, 'inbox:ru_notreal')).status, 404)
  assert.deepEqual(await (await report({ picked: true })).json(), { object: 'wake', id: run.id })
  assert.equal((await report({ said: 'Chased.' })).status, 200)
  const row = await db.selectFrom('inbox_source').select(['run_status', 'run_text']).where('run_id', '=', run.id.slice('inbox:'.length)).executeTakeFirstOrThrow()
  assert.deepEqual(row, { run_status: 'told', run_text: 'Chased.' })
  assert.ok(!(await wakes.due({ agentId: 'ag_wakeagnt' })).some((wake) => wake.id === run.id))
  const decision = (await wakes.due({ agentId: 'ag_wakeagnt' })).find((wake) => wake.origin.platform === 'whatsapp')
  assert.ok(decision)
  await wakes.report({ agentId: 'ag_wakeagnt', id: decision.id, body: { picked: true, said: 'Told them.' } })
  assert.ok(!(await wakes.due({ agentId: 'ag_wakeagnt' })).some((wake) => wake.id === decision.id), 'asks has no said; picked is enough')
})

test('a channel wake nobody picks up is logged once, five minutes on, and an app wake never is', async () => {
  const warned = mock.method(log, 'warn', () => undefined)
  const at = new Date('2026-01-01T10:00:00Z')
  for (const [id, origin] of [['wh_wakestck', whatsapp], ['wh_wakeappx', app]] as const) {
    await db.insertInto('inbox_source').values({ id, agent_id: 'ag_wakeagnt', kind: 'webhook', name: id, origin: JSON.stringify(origin) }).execute()
    await db.insertInto('inbox_item').values({ id: `hd_${id.slice(3)}`, source_id: id, agent_id: 'ag_wakeagnt', digest: id, text: 'x', created_at: at }).execute()
  }
  const stuck = () => warned.mock.calls.map((call) => call.arguments[0] as { event: string; item: string }).filter((entry) => entry.event === 'inbox.not_picked' && entry.item.startsWith('hd_wake'))
  for (const minutes of [4, 5.5, 6.5]) await inboxService.tick({ now: new Date(at.getTime() + minutes * 60_000) })
  assert.deepEqual(stuck().map((entry) => entry.item), ['hd_wakestck'])
  warned.mock.restore()
})

test('a Discord turn the Hermes plugin reports lands in that channel thread\'s web thread; other platforms are refused', async () => {
  const turn = (origin: Record<string, string>) => fetch(url('/turns'), { method: 'POST', headers, body: JSON.stringify({ user: 'is prod up?', reply: 'Yes.', origin }) })
  const res = await turn({ platform: 'discord', chat_id: '444', thread_id: '444', parent_chat_id: '333', chat_name: 'incident', user_name: 'ana' })
  const { id } = await res.json() as { id: string }
  const row = await db.selectFrom('chat_thread').select(['key', 'mirrors']).where('id', '=', id).executeTakeFirstOrThrow()
  assert.deepEqual([row.key, JSON.parse(row.mirrors)], ['discord:333:444', [{ platform: 'discord', chat_id: '333', thread_id: '444', chat_name: 'incident' }]])
  assert.equal((await turn({ platform: 'telegram', chat_id: '1' })).status, 400)
})

test('the Hermes plugin asks for a Discord thread\'s OpenHut context through the gateway', async () => {
  const ask = (body: unknown) => fetch(url('/thread-context'), { method: 'POST', headers, body: JSON.stringify(body) })
  assert.deepEqual(await (await ask({ origin: { platform: 'discord', chat_id: '999', thread_id: '999', parent_chat_id: '1' } })).json(), { object: 'thread_context', context: null })
  assert.equal((await ask({})).status, 400)
})
