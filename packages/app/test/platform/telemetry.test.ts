import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { config } from '../../src/platform/config.ts'
import { db, migrate } from '../../src/platform/db.ts'
import { record, setUsageData, takeTelemetry, track } from '../../src/platform/events.ts'
import { agentd } from '../../src/platform/agentd.ts'
import { reportActive, reportMessages, sendTelemetry } from '../../src/platform/telemetry.ts'

await migrate()
const actor = { id: 'usr_telemtry', email: 'owner@acme.example' }
const INSTANCE = '0b9c2f2e-3c1d-4b6a-9f1e-2a7d5c8e1f00'

test('telemetry is off for test-model servers, so tests and the e2e run never send anything', () => {
  assert.equal(config.telemetry, false)
  record({ action: 'agent.created', actor, target: { type: 'agent', id: 'ag_x', name: 'Payroll', model: 'sonnet' } })
  assert.deepEqual(takeTelemetry(), [])
})

test('audit actions become events with only safe properties; the owner\'s email is the one personal detail', () => {
  config.telemetry = true
  record({ action: 'agent.created', actor, target: { type: 'agent', id: 'ag_x', name: 'Payroll bot', model: 'sonnet' } })
  record({ action: 'person.joined', actor, target: { type: 'person', id: 'usr_telemtry', role: 'owner' } })
  record({ action: 'person.joined', actor: { id: 'usr_b', email: 'bea@acme.example' }, target: { type: 'person', id: 'usr_b', role: 'member' } })
  record({ action: 'oauth.app_connected', actor, target: { type: 'oauth_client', id: 'c1', name: 'Claude Code' } })
  record({ action: 'connection.reconnected', actor, target: { type: 'connection', id: 'cn_x' } })
  track('dashboard_page_viewed', { page: 'agents', path: '/agents/ag_x' })
  config.telemetry = false
  assert.deepEqual(takeTelemetry().map(({ name, properties }) => ({ name, properties })), [
    { name: 'agent_created', properties: { model: 'sonnet' } },
    { name: 'setup_completed', properties: { owner_email: 'owner@acme.example' } },
    { name: 'person_joined', properties: { role: 'member' } },
    { name: 'assistant_connected', properties: { client: 'claude' } },
    { name: 'dashboard_page_viewed', properties: { page: 'agents' } },
  ])
})

test('the daily check-in reports buckets and the owner\'s email, and a batch goes to the hub with the instance', async () => {
  await db.insertInto('person').values([
    { id: 'usr_telown1', email: 'owner@acme.example', pass: 'x', role: 'owner', removed_at: null },
    { id: 'usr_telmem1', email: 'm@acme.example', pass: 'x', role: 'member', removed_at: null },
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
  assert.deepEqual(body.events.map(({ name, properties }: { name: string; properties: unknown }) => ({ name, properties })), [
    { name: 'instance_active', properties: { agents: '0', people: '2-5', owner_email: 'owner@acme.example' } },
  ])
  posted.mock.restore()
})

test('a failed send only logs and drops the batch', async () => {
  config.telemetry = true
  track('skill_edited')
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
  track('skill_edited')
  setUsageData(false)
  track('skill_deleted')
  assert.deepEqual(takeTelemetry(), [])
  setUsageData(true)
  track('memory_edited')
  config.telemetry = false
  assert.deepEqual(takeTelemetry().map(({ name }) => name), ['memory_edited'])
})
