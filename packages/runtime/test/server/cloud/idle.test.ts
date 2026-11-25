import { test } from 'node:test'
import assert from 'node:assert/strict'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { busy } from '../../../src/server/cloud/idle.ts'
import { activity } from '../../../src/server/gateway/activity.ts'
import { busy as turns } from '../../../src/server/threads/thread-service.ts'

await migrate()
await db.insertInto('person').values({ id: 'usr_idleowner', email: 'idle@example.com', role: 'owner', removed_at: null }).execute()

test('idle: an open chat with nothing running is idle', async () => {
  assert.equal(await busy(), false)
})

test('idle: a turn keeps it busy, including a long shell call inside it', async () => {
  turns.add('th_long_shell')
  assert.equal(await busy(), true)
  turns.delete('th_long_shell')
  assert.equal(await busy(), false)
})

test('idle: gateway traffic keeps it busy for a minute', async (t) => {
  activity.started('ag_idle')
  assert.equal(await busy(), true)
  activity.ended('ag_idle')
  assert.equal(await busy(), true)
  t.mock.method(Date, 'now', () => new Date().getTime() + 61_000)
  assert.equal(await busy(), false)
})

test('idle: Slack keeps it busy', async () => {
  await db.insertInto('agent').values({ id: 'ag_idleslack', name: 'Juniper', owner_id: 'usr_idleowner', instructions: '#', model: 'claude:sonnet', net: 72, channel_key: 'k', wanted: 'running' }).execute()
  await db.insertInto('channel').values({ id: 'ch_idleslack', agent_id: 'ag_idleslack', kind: 'slack', status: 'connected', account: null, owner_address: '', secrets: '', open: false, allowed: '[]' }).execute()
  assert.equal(await busy(), true)
})
