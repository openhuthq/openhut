import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { setTimeout as sleep } from 'node:timers/promises'
import { db, migrate } from '../../src/platform/db.ts'
import { agentd } from '../../src/platform/agentd.ts'
import { seal } from '../../src/platform/secrets.ts'
import { automationService } from '../../src/automations/automation-service.ts'

await migrate()
await db.insertInto('person').values([
  { id: 'usr_autoownr', email: 'autoowner@example.com', pass: 'x', role: 'admin', removed_at: null },
  { id: 'usr_automemb', email: 'automember@example.com', pass: 'x', role: 'member', removed_at: null },
]).execute()
await db.insertInto('agent').values([
  { id: 'ag_autorunn', name: 'Digest', owner_id: 'usr_autoownr', instructions: '# Digest', model: 'sonnet', net: 31, channel_key: seal('k'.repeat(48)), wanted: 'running' },
  { id: 'ag_autostop', name: 'Sleeper', owner_id: 'usr_autoownr', instructions: '# Sleeper', model: 'sonnet', net: 32, channel_key: seal('k'.repeat(48)) },
]).execute()
const owner = { id: 'usr_autoownr', email: 'autoowner@example.com', role: 'admin' as const }
const member = { id: 'usr_automemb', email: 'automember@example.com', role: 'member' as const }
mock.method(agentd, 'ps', async () => ({ states: {} }))
const sends = mock.method(agentd, 'send', async ({ to }: { to: string }) => ({ sent: to }))

const prompts: string[] = []
const hermes = createServer((req, res) => {
  let raw = ''
  req.on('data', (chunk) => { raw += chunk })
  req.on('end', () => {
    const content: string = JSON.parse(raw).messages[0].content
    prompts.push(content)
    const answer = content.includes('nothing new') ? '[SILENT]' : 'Two deals moved: Acme to Won, Globex to Demo.'
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`)
  })
}).listen(18649, '127.0.0.1')

async function settled(automationId: string) {
  for (let i = 0; i < 50; i++) {
    const [run] = await automationService.runs({ actor: owner, automationId })
    if (run && run.status !== 'running') return run
    await sleep(20)
  }
  throw new Error('the run never finished')
}

test('only someone who can change the agent creates automations, and a schedule gets its next run', async () => {
  const body = { agentId: 'ag_autorunn', name: 'Morning digest', instructions: 'Post the pipeline digest.', schedule: { every: 'weekdays' as const, at: '09:00' }, postTo: 'telegram:626583434' }
  await assert.rejects(automationService.create({ actor: member, body }), { status: 403 })
  const automation = await automationService.create({ actor: owner, body })
  assert.equal(automation.trigger, 'schedule')
  assert.equal(automation.webhookUrl, null)
  assert.ok(automation.nextRunAt && new Date(automation.nextRunAt) > new Date())
  assert.equal((await automationService.list({ actor: member, agentId: 'ag_autorunn' })).length, 1)
})

test('a run asks Hermes in a fresh session and Hermes posts the answer through agentd', async () => {
  const [automation] = await automationService.list({ actor: owner, agentId: 'ag_autorunn' })
  const run = await automationService.runNow({ actor: owner, automationId: automation.id })
  assert.equal(run.status, 'running')
  await assert.rejects(automationService.runNow({ actor: owner, automationId: automation.id }), { status: 429 })
  const done = await settled(automation.id)
  assert.equal(done.status, 'done')
  assert.equal(done.answer, 'Two deals moved: Acme to Won, Globex to Demo.')
  assert.match(prompts.at(-1) ?? '', /\[SILENT\][\s\S]*Post the pipeline digest\./)
  assert.deepEqual(sends.mock.calls.at(-1)?.arguments[0], { id: 'ag_autorunn', to: 'telegram:626583434', text: 'Two deals moved: Acme to Won, Globex to Demo.' })
  assert.equal((await automationService.get({ actor: owner, id: automation.id })).lastRun?.status, 'done')
})

test('a [SILENT] answer is kept as quiet and nothing is posted', async () => {
  const automation = await automationService.create({ actor: owner, body: { agentId: 'ag_autorunn', name: 'Quiet', instructions: 'Say nothing new.', schedule: { every: 'daily', at: '07:00' }, postTo: 'slack:C0GTM' } })
  const before = sends.mock.callCount()
  await automationService.runNow({ actor: owner, automationId: automation.id })
  assert.equal((await settled(automation.id)).status, 'quiet')
  assert.equal(sends.mock.callCount(), before)
})

test('a stopped agent skips the run without calling Hermes', async () => {
  const automation = await automationService.create({ actor: owner, body: { agentId: 'ag_autostop', name: 'Asleep', instructions: 'Anything.', schedule: { every: 'daily', at: '07:00' } } })
  const asked = prompts.length
  await automationService.runNow({ actor: owner, automationId: automation.id })
  const run = await settled(automation.id)
  assert.equal(run.status, 'skipped')
  assert.match(run.error ?? '', /Sleeper was stopped/)
  assert.equal(prompts.length, asked)
})

test('a webhook needs its secret, passes the body to Hermes, and its secret is shown only once', async () => {
  const created = await automationService.create({ actor: owner, body: { agentId: 'ag_autorunn', name: 'New lead', instructions: 'Tell the team about this lead.', webhook: true } })
  assert.ok(created.webhookSecret?.startsWith('whsec_'))
  assert.match(created.webhookUrl ?? '', new RegExp(`/hooks/${created.id}$`))
  assert.equal((await automationService.get({ actor: owner, id: created.id })).webhookSecret, undefined)
  await assert.rejects(automationService.trigger({ id: created.id, authorization: 'Bearer whsec_wrong', body: {} }), { status: 401 })
  await assert.rejects(automationService.trigger({ id: 'au_nothere1', authorization: `Bearer ${created.webhookSecret}`, body: {} }), { status: 401 })
  await automationService.trigger({ id: created.id, authorization: `Bearer ${created.webhookSecret}`, body: { email: 'lead@example.com' } })
  const run = await settled(created.id)
  assert.equal(run.trigger, 'webhook')
  assert.match(prompts.at(-1) ?? '', /lead@example\.com/)
  await automationService.update({ actor: owner, id: created.id, patch: { enabled: false } })
  await assert.rejects(automationService.trigger({ id: created.id, authorization: `Bearer ${created.webhookSecret}`, body: {} }), { status: 409 })
})

test('the timer runs what is due, moves it to its next time, and skips runs missed by more than an hour', async () => {
  const automation = await automationService.create({ actor: owner, body: { agentId: 'ag_autorunn', name: 'Due now', instructions: 'Post the pipeline digest.', schedule: { every: 'daily', at: '06:00' } } })
  const missed = await automationService.create({ actor: owner, body: { agentId: 'ag_autorunn', name: 'Missed', instructions: 'Post the pipeline digest.', schedule: { every: 'daily', at: '06:00' } } })
  await db.updateTable('automation').set({ next_run_at: new Date(Date.now() - 1000) }).where('id', '=', automation.id).execute()
  await db.updateTable('automation').set({ next_run_at: new Date(Date.now() - 2 * 3_600_000) }).where('id', '=', missed.id).execute()
  await automationService.tick()
  assert.equal((await settled(automation.id)).trigger, 'schedule')
  assert.equal((await settled(missed.id)).status, 'skipped')
  const moved = await automationService.get({ actor: owner, id: automation.id })
  assert.ok(moved.nextRunAt && new Date(moved.nextRunAt) > new Date())
})

test('deleting an automation removes it and its runs', async () => {
  const [automation] = await automationService.list({ actor: owner, agentId: 'ag_autorunn' })
  await assert.rejects(automationService.delete({ actor: member, id: automation.id }), { status: 403 })
  await automationService.delete({ actor: owner, id: automation.id })
  await assert.rejects(automationService.get({ actor: owner, id: automation.id }), { status: 404 })
  assert.equal((await db.selectFrom('automation_run').selectAll().where('automation_id', '=', automation.id).execute()).length, 0)
  hermes.close()
})
