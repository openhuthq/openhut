import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { config } from '../../../src/server/platform/config.ts'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { emit, log, setUsageData, takeTelemetry } from '../../../src/server/platform/events.ts'
import { agentd } from '../../../src/server/platform/agentd.ts'
import { reportActive, reportMessages, sendTelemetry } from '../../../src/server/platform/telemetry.ts'

await migrate()
const actor = { id: 'usr_telemtry', email: 'owner@acme.example' }
const INSTANCE = '0b9c2f2e-3c1d-4b6a-9f1e-2a7d5c8e1f00'

test('telemetry is off for test-model servers, so tests and the e2e run never send anything', () => {
  assert.equal(config.telemetry, false)
  emit({ name: 'agent.created', actor, target: { type: 'agent', id: 'ag_x', name: 'Payroll', model: 'sonnet' } })
  assert.deepEqual(takeTelemetry(), [])
})

test('every event is logged, and only catalog events are queued, with only safe properties and no email', () => {
  config.telemetry = true
  const logged = mock.method(log, 'info', () => {})
  emit({ name: 'agent.created', actor, target: { type: 'agent', id: 'ag_x', name: 'Payroll bot', model: 'sonnet' } })
  emit({ name: 'setup.completed', actor, target: { type: 'person', id: 'usr_telemtry' } })
  emit({ name: 'connection.reconnected', actor, target: { type: 'connection', id: 'cn_x' } })
  emit({ name: 'dashboard.page_viewed', properties: { page: 'agents', path: '/agents/ag_x' } })
  emit({ name: 'app.started', properties: { version: '0.1.4', kind: 'mac' } })
  logged.mock.restore()
  config.telemetry = false
  assert.deepEqual(logged.mock.calls.map((call) => (call.arguments[0] as { event: string }).event), ['agent.created', 'setup.completed', 'connection.reconnected', 'dashboard.page_viewed', 'app.started'])
  assert.deepEqual(takeTelemetry().map(({ name, properties }) => ({ name, properties })), [
    { name: 'agent_created', properties: { model: 'sonnet' } },
    { name: 'setup_completed', properties: {} },
    { name: 'dashboard_page_viewed', properties: { page: 'agents' } },
    { name: 'app_started', properties: {} },
  ])
})

test('the daily check-in reports buckets, never an email, and a batch goes to the hub with the instance', async () => {
  await db.insertInto('person').values([
    { id: 'usr_telown1', email: 'owner@acme.example', role: 'owner', removed_at: null },
    { id: 'usr_telmem1', email: 'm@acme.example', role: 'member', removed_at: null },
  ]).execute()
  config.telemetry = true
  await reportActive()
  config.telemetry = false
  const posted = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 202 }))
  await sendTelemetry(INSTANCE)
  const [url, init] = posted.mock.calls[0].arguments as [string, RequestInit]
  const body = JSON.parse(String(init.body))
  assert.equal(url, config.telemetryUrl)
  assert.equal(body.instance, INSTANCE)
  assert.equal(body.kind, 'server')
  assert.deepEqual(body.events.map(({ name, properties }: { name: string; properties: unknown }) => ({ name, properties })), [
    { name: 'instance_active', properties: { agents: '0' } },
  ])
  posted.mock.restore()
})

test('a failed send only logs and drops the batch', async () => {
  config.telemetry = true
  emit({ name: 'skill.updated', target: { type: 'skill', id: 's' } })
  config.telemetry = false
  const failing = mock.method(globalThis, 'fetch', async () => { throw new Error('offline') })
  await sendTelemetry(INSTANCE)
  failing.mock.restore()
  assert.deepEqual(takeTelemetry(), [])
})

test('each new message from a person becomes one event with only its channel, agent name and time', async () => {
  await db.insertInto('agent').values({ id: 'ag_msgagent', name: 'Ops Desk', owner_id: 'usr_telown1', instructions: '# Ops', model: 'sonnet', net: 12, channel_key: 'k' }).execute()
  const found = mock.method(agentd, 'newMessages', async () => ({ messages: [{ agentId: 'ag_msgagent', source: 'slack', at: 1000.25 }, { agentId: 'ag_msgagent', source: 'api_server', at: 1001 }, { agentId: 'ag_gone0000', source: 'cron', at: 1002 }] }))
  config.telemetry = true
  const next = await reportMessages(900)
  config.telemetry = false
  found.mock.restore()
  assert.equal(next, 1002)
  assert.deepEqual(takeTelemetry().map(({ name, properties, at }) => ({ name, properties, at })), [
    { name: 'message_sent', properties: { channel: 'slack', agent_name: 'Ops Desk' }, at: 1000250 },
    { name: 'message_sent', properties: { channel: 'dashboard', agent_name: 'Ops Desk' }, at: 1001000 },
    { name: 'message_sent', properties: { channel: 'other' }, at: 1002000 },
  ])
})

test('turning usage data off in Admin stops tracking and drops anything not sent yet', () => {
  config.telemetry = true
  emit({ name: 'skill.updated', target: { type: 'skill', id: 's' } })
  setUsageData(false)
  emit({ name: 'skill.deleted', target: { type: 'skill', id: 's' } })
  assert.deepEqual(takeTelemetry(), [])
  setUsageData(true)
  emit({ name: 'memory.updated', target: { type: 'memory', id: 'm' } })
  config.telemetry = false
  assert.deepEqual(takeTelemetry().map(({ name }) => name), ['memory_edited'])
})

test('in local mode no event carries an email, login or username, only the anonymous instance id', async () => {
  config.telemetry = true
  config.socket = '/tmp/openhut-test.sock'
  emit({ name: 'setup.completed', actor: { id: 'usr_local1', email: 'owner@acme.example' }, target: { type: 'person', id: 'usr_local1' } })
  await reportActive()
  config.socket = undefined
  config.telemetry = false
  const sent = JSON.stringify(takeTelemetry())
  assert.match(sent, /setup_completed/)
  assert.match(sent, /instance_active/)
  assert.doesNotMatch(sent, /email|login|username|owner@acme/)
})
