import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wakes } from '../../../src/core/wakes.ts'
import { asks } from '../../../src/core/asks.ts'
import { inboxService } from '../../../src/server/inbox/inbox-service.ts'
import { routineService } from '../../../src/server/inbox/routines.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { seal } from '../../../src/server/platform/secrets.ts'
import { fakeAgentd, refresh, signIn } from '../../server/agents/signed-in.ts'
import { appWakes } from './app-wakes.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_appwownr', email: 'appw@example.com', role: 'owner', removed_at: null }).execute()
await db.insertInto('agent').values({ id: 'ag_appwagnt', name: 'Dev', owner_id: 'usr_appwownr', instructions: '#', model: 'claude:sonnet', net: 94, channel_key: seal('k'.repeat(48)), wanted: 'running' }).execute()
await db.insertInto('channel').values({ id: 'ch_appwwhat', agent_id: 'ag_appwagnt', kind: 'whatsapp', status: 'connected', account: null, owner_address: '15550005555', open: true, allowed: '', secrets: '' }).execute()
fakeAgentd()
signIn({ email: 'appw@example.com' })
await refresh()
const owner = { id: 'usr_appwownr', email: 'appw@example.com', role: 'owner' as const }
const app = { platform: 'api_server', chat_id: 'openhut-msg_appwchat' }
const whatsapp = { platform: 'whatsapp', chat_id: '15550005555@s.whatsapp.net', chat_type: 'dm' }
let fail = 0
const picked: (Date | null)[] = []
const { told, deliver, settled } = appWakes({
  reply: async ({ text }) => {
    const run = /inbox:(ru_[a-z0-9]+)/.exec(text)?.[1]
    if (run) picked.push((await db.selectFrom('inbox_source').select('run_picked_at').where('run_id', '=', run).executeTakeFirstOrThrow()).run_picked_at)
    if (fail-- > 0) throw new Error('The agent didn\'t answer.')
    return 'Acme paid.'
  },
})

test('an app routine run is picked, run once in the app chat however often it is nudged, and its reply is reported', async () => {
  const id = /rt_[a-z0-9]+/.exec(await routineService.schedule({ agentId: 'ag_appwagnt', input: { name: 'Check Acme', plan: 'Stripe.', cron: '0 9 * * *', origin: app } }))?.[0] ?? ''
  await db.updateTable('inbox_source').set({ next_run_at: new Date(Date.now() - 60_000) }).where('id', '=', id).execute()
  await inboxService.tick()
  wakes.nudge('ag_appwagnt')
  wakes.nudge('ag_appwagnt')
  deliver('ag_appwagnt')
  await settled()
  assert.equal(told.length, 1)
  assert.match(told[0].text, /^\[OpenHut inbox:ru_[a-z0-9]+\] Routine rt_[a-z0-9]+: time for "Check Acme"/)
  assert.ok(picked[0], 'picked before the turn, so a long turn is not failed as never picked up')
  const row = await db.selectFrom('inbox_source').select(['run_status', 'run_text']).where('id', '=', id).executeTakeFirstOrThrow()
  assert.deepEqual(row, { run_status: 'told', run_text: 'Acme paid.' })
  await routineService.cancel({ agentId: 'ag_appwagnt', id, reason: 'done' })
})

test('a decision asked from WhatsApp is left to the Hermes plugin; one asked in the app is delivered, and a failed turn is tried again', async (t) => {
  const fromWhatsApp = /ask_[a-z0-9]+/.exec(await asks.create({ agentId: 'ag_appwagnt', kind: 'update_self', input: { name: 'Op' }, description: 'Needed for the job', origin: whatsapp }))?.[0] ?? ''
  await asks.decline({ actor: owner, id: fromWhatsApp })
  deliver('ag_appwagnt')
  await settled()
  assert.equal(told.length, 1)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  fail = 1
  const fromApp = /ask_[a-z0-9]+/.exec(await asks.create({ agentId: 'ag_appwagnt', kind: 'update_self', input: { name: 'Ops' }, description: 'Needed for the job', origin: app }))?.[0] ?? ''
  await asks.decline({ actor: owner, id: fromApp })
  for (let i = 0; i < 50 && told.length < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve))
    t.mock.timers.tick(30_000)
  }
  await settled()
  assert.equal(told.length, 3)
  for (const each of told.slice(1)) assert.match(each.text, /^\[OpenHut asks:wk_[a-z0-9]+\] Your owner answered your ask:\n- Not approved: Rename to Ops\./)
  const row = await db.selectFrom('ask').select('told').where('id', '=', fromApp).executeTakeFirstOrThrow()
  assert.equal(row.told, true)
  assert.ok((await wakes.due({ agentId: 'ag_appwagnt' })).every((wake) => wake.origin.platform !== 'api_server'))
})
