import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { settings } from '../../../src/server/platform/settings.ts'
import { routineService } from '../../../src/server/routines/routine-service.ts'
import { recordsService, type Held } from '../../../src/server/cloud/records.ts'
import { runSet } from '../../../src/server/cloud/run-set.ts'
import { fakeAgentd, HOME, signIn } from '../agents/signed-in.ts'

await migrate()
await settings.setTimeZone('Europe/Berlin')
await db.insertInto('person').values({ id: 'usr_rtnowner', email: 'rtn@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values([
  { id: 'ag_rtnfirst', name: 'Dev', owner_id: 'usr_rtnowner', instructions: '#', model: 'claude:sonnet', net: 61, channel_key: seal('k'.repeat(48)), wanted: 'running' },
  { id: 'ag_rtnother', name: 'Ops', owner_id: 'usr_rtnowner', instructions: '#', model: 'claude:sonnet', net: 62, channel_key: seal('k'.repeat(48)), wanted: 'running' },
]).execute()
await db.insertInto('channel').values([
  { id: 'ch_rtnwhats', agent_id: 'ag_rtnfirst', kind: 'whatsapp', status: 'connected', account: null, owner_address: '15550001111', open: true, allowed: '', secrets: '' },
  { id: 'ch_rtnslack', agent_id: 'ag_rtnfirst', kind: 'slack', status: 'connected', account: null, owner_address: '', open: false, allowed: 'C0FINANCE1', secrets: '' },
]).execute()
fakeAgentd()
signIn({ email: 'rtn@example.com' })
await runSet.refresh()

const owner = { id: 'usr_rtnowner', email: 'rtn@example.com', local: true, role: 'owner' as const }
const app = { platform: 'api_server', chat_id: 'openhut-msg_rtnchat1' }
const whatsapp = { platform: 'whatsapp', chat_id: '15550001111@s.whatsapp.net', chat_type: 'dm', chat_name: 'Mo' }
const slack = { platform: 'slack', chat_id: 'C0FINANCE1', chat_type: 'group', chat_name: 'finance', thread_id: '1732.1' }
const minutes = (n: number) => new Date(Date.now() + n * 60_000)
const idOf = (reply: string) => /Scheduled (rt_[a-z0-9]+)/.exec(reply)?.[1] ?? ''
const rowOf = (id: string) => db.selectFrom('routine').selectAll().where('id', '=', id).executeTakeFirst()
const runs: { agentId: string; text: string }[] = []
routineService.runDashboardWith(async (input) => {
  runs.push(input)
  return 'Acme paid #4471.'
})

test('a routine needs a chat of the agent\'s own, and one of at or cron', async () => {
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'x', plan: 'y', at: minutes(5).toISOString() } }), /chat you're in/)
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnother', input: { name: 'x', plan: 'y', at: minutes(5).toISOString(), origin: { ...app, chat_id: 'telegram-123' } } }), /chat you're in/)
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'x', plan: 'y', at: minutes(5).toISOString(), origin: { ...whatsapp, chat_id: '15559998888@s.whatsapp.net' } } }), /WhatsApp chat any more/)
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'x', plan: 'y', at: minutes(5).toISOString(), origin: { ...slack, chat_id: 'C0RANDOM01' } } }), /any more/)
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'x', plan: 'y', origin: app } }), /either at/)
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'x', plan: 'y', cron: '*/5 * * * *', origin: app } }), /every 15 minutes/)
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'x', plan: 'y', cron: 'nope', origin: app } }), /isn't a cron/)
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'x', plan: 'y', at: minutes(5).toISOString(), origin: { ...slack, chat_type: 'dm', chat_id: 'C0RANDOM01' } } }), /any more/)
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'x', plan: 'y', cron: '0,20,40,55,56 * * * *', origin: app } }), /every 15 minutes/)
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'x', plan: 'y', at: '2026-11-28T09:00:00', origin: app } }), /offset/)
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'x', plan: 'y', at: minutes(-10).toISOString(), origin: app } }), /has passed/)
})

test('a dashboard routine runs in its thread, says what it found, and a once routine then goes away', async () => {
  const reply = await routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'Check Acme paid', plan: 'Look at Stripe.', at: minutes(1).toISOString(), origin: app } })
  assert.match(reply, /^Scheduled rt_[a-z0-9]+, next .+\. Reports go to the OpenHut app\.$/)
  const id = idOf(reply)
  const [listed] = await routineService.list({ actor: owner, agentId: 'ag_rtnfirst' })
  assert.deepEqual({ name: listed.name, place: listed.place, platform: listed.platform, stopped: listed.stopped, last: listed.last }, { name: 'Check Acme paid', place: 'the OpenHut app', platform: 'api_server', stopped: null, last: null })
  await routineService.tick({ now: minutes(2) })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(runs.length, 1)
  assert.match(runs[0].text, /^\[Routine rt_[a-z0-9]+ · run ru_[a-z0-9]+\] Time for "Check Acme paid"\. Your plan: Look at Stripe\./)
  assert.match(runs[0].text, /This runs once and ends by itself\.$/)
  assert.doesNotMatch(runs[0].text, /cancel_routine/)
  assert.equal(await rowOf(id), undefined)
})

test('a chat routine waits for the plugin, which marks it picked and reports what the agent said', async () => {
  const id = idOf(await routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'Chase Acme on #4471', plan: 'Nudge Acme.', cron: '0 10 * * 1-5', origin: whatsapp } }))
  const routine = (await routineService.list({ actor: owner, agentId: 'ag_rtnfirst' })).find((each) => each.id === id)
  assert.equal(routine?.place, 'your WhatsApp')
  assert.equal(routine?.until && Math.round((new Date(routine.until).getTime() - Date.now()) / 86_400_000), 90)
  await db.updateTable('routine').set({ next_run_at: minutes(-1) }).where('id', '=', id).execute()
  await routineService.tick()
  const [due] = await routineService.due({ agentId: 'ag_rtnfirst' })
  assert.equal(due.routineId, id)
  assert.deepEqual(due.origin, whatsapp)
  assert.deepEqual(await routineService.due({ agentId: 'ag_rtnother' }), [])
  await assert.rejects(routineService.report({ agentId: 'ag_rtnfirst', runId: due.runId, said: 'early' }), { status: 404 })
  await assert.rejects(routineService.picked({ agentId: 'ag_rtnother', runId: due.runId }), { status: 404 })
  await routineService.picked({ agentId: 'ag_rtnfirst', runId: due.runId })
  assert.deepEqual(await routineService.due({ agentId: 'ag_rtnfirst' }), [])
  await assert.rejects(routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'Copy me', plan: 'again', at: minutes(30).toISOString(), origin: slack } }), /can't set up another routine/)
  await routineService.report({ agentId: 'ag_rtnfirst', runId: due.runId, said: 'Acme asked for a PO number.' })
  await assert.rejects(routineService.report({ agentId: 'ag_rtnfirst', runId: due.runId, said: 'twice' }), { status: 404 })
  const after = (await routineService.list({ actor: owner, agentId: 'ag_rtnfirst' })).find((each) => each.id === id)
  assert.deepEqual({ status: after?.last?.status, text: after?.last?.text }, { status: 'told', text: 'Acme asked for a PO number.' })
  assert.ok(after?.nextRunAt && new Date(after.nextRunAt) > new Date())
  await assert.rejects(routineService.cancel({ agentId: 'ag_rtnother', id, reason: 'x' }), { status: 404 })
  assert.equal(await routineService.cancel({ agentId: 'ag_rtnfirst', id, reason: 'Paid' }), 'Stopped.')
})

test('a quiet run says nothing, and a stopped agent\'s routine waits until it runs again', async () => {
  const id = idOf(await routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'Watch #finance', plan: 'Check.', cron: '0 9 * * *', origin: slack } }))
  await db.updateTable('agent').set({ wanted: 'stopped' }).where('id', '=', 'ag_rtnfirst').execute()
  await db.updateTable('routine').set({ next_run_at: minutes(-1) }).where('id', '=', id).execute()
  await routineService.tick()
  assert.equal((await rowOf(id))?.run_status, null)
  await db.updateTable('agent').set({ wanted: 'running' }).where('id', '=', 'ag_rtnfirst').execute()
  await routineService.tick()
  const [due] = await routineService.due({ agentId: 'ag_rtnfirst' })
  assert.equal(due.origin.chat_name, 'finance')
  await routineService.picked({ agentId: 'ag_rtnfirst', runId: due.runId })
  await routineService.report({ agentId: 'ag_rtnfirst', runId: due.runId, said: '[SILENT]' })
  const row = await rowOf(id)
  assert.deepEqual({ status: row?.run_status, text: row?.run_text }, { status: 'quiet', text: null })
  await routineService.cancel({ agentId: 'ag_rtnfirst', id, reason: 'done' })
})

test('runs nobody picks up fail, and three in a row stop the routine where the owner sees it', async () => {
  const id = idOf(await routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'Watch the build', plan: 'Check CI.', cron: '0 * * * *', origin: slack } }))
  for (const round of [1, 2, 3]) {
    await db.updateTable('routine').set({ next_run_at: minutes(-1) }).where('id', '=', id).execute()
    await routineService.tick()
    await db.updateTable('routine').set({ run_at: minutes(-6) }).where('id', '=', id).execute()
    await routineService.tick()
    assert.equal((await rowOf(id))?.failures, round)
  }
  const [stopped] = (await routineService.list({ actor: owner, agentId: 'ag_rtnfirst' })).filter((each) => each.id === id)
  assert.deepEqual({ stopped: stopped.stopped, next: stopped.nextRunAt, last: stopped.last?.text }, { stopped: 'Stopped after 3 failed tries', next: null, last: 'Not picked up.' })
  assert.deepEqual(await routineService.stop({ actor: owner, id }), { id, object: 'routine', deleted: true })
})

test('a chat the agent left fails the run, and until passing ends a routine', async () => {
  const id = idOf(await routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'Post in #finance', plan: 'Post.', cron: '0 8 * * *', until: minutes(60 * 24 * 3).toISOString(), origin: slack } }))
  await db.updateTable('channel').set({ allowed: '' }).where('id', '=', 'ch_rtnslack').execute()
  await db.updateTable('routine').set({ next_run_at: minutes(-1) }).where('id', '=', id).execute()
  await routineService.tick()
  const row = await rowOf(id)
  assert.deepEqual({ status: row?.run_status, text: row?.run_text }, { status: 'failed', text: 'Can\'t post in #finance any more.' })
  await routineService.tick({ now: minutes(60 * 24 * 4) })
  assert.equal(await rowOf(id), undefined)
  await db.updateTable('channel').set({ allowed: 'C0FINANCE1' }).where('id', '=', 'ch_rtnslack').execute()
})

test('a routine is backed up as a record, and a routine record from another computer is scheduled here', async () => {
  const id = idOf(await routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'Weekly digest', plan: 'Sum up.', cron: '0 9 * * 1', origin: app } }))
  const held = await recordsService.get({ collection: 'routine', workspace: HOME, id })
  assert.deepEqual([held?.parent, (held?.value as { name?: string })?.name], ['ag_rtnfirst', 'Weekly digest'])
  await routineService.applyRecords({ agentId: 'ag_rtnother', records: [{ ...held, id: 'rt_fromthere', parent: 'ag_rtnother' } as Held] })
  const arrived = (await routineService.list({ actor: owner, agentId: 'ag_rtnother' })).find((each) => each.id === 'rt_fromthere')
  assert.equal(arrived?.name, 'Weekly digest')
  await routineService.cancel({ agentId: 'ag_rtnfirst', id, reason: 'done' })
  assert.equal((await recordsService.get({ collection: 'routine', workspace: HOME, id }))?.deleted, true)
})

test('changing the time zone moves the next run of repeating routines', async () => {
  const id = idOf(await routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'Morning note', plan: 'Say hi.', cron: '0 9 * * *', origin: app } }))
  const before = new Date((await rowOf(id))?.next_run_at ?? 0)
  await routineService.setTimeZone('America/New_York')
  const after = new Date((await rowOf(id))?.next_run_at ?? 0)
  assert.equal(before.getUTCHours(), 8)
  assert.equal(after.getUTCHours(), 14)
  await routineService.setTimeZone('Europe/Berlin')
  await routineService.cancel({ agentId: 'ag_rtnfirst', id, reason: 'done' })
})

test('two ticks at once fire a due routine once', async () => {
  const id = idOf(await routineService.schedule({ agentId: 'ag_rtnfirst', input: { name: 'Nudge #finance', plan: 'Nudge.', cron: '0 7 * * *', origin: slack } }))
  await db.updateTable('routine').set({ next_run_at: minutes(-1) }).where('id', '=', id).execute()
  await Promise.all([routineService.tick(), routineService.tick()])
  const runs = await routineService.due({ agentId: 'ag_rtnfirst' })
  assert.equal(runs.filter((run) => run.routineId === id).length, 1)
  await routineService.cancel({ agentId: 'ag_rtnfirst', id, reason: 'done' })
})
