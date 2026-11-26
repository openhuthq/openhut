import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checked, plugins } from '../../src/core/plugins.ts'
import { definePlugin, defineTool } from '../../src/core/plugin.ts'
import { sql } from 'kysely'
import { db, migrate } from '../../src/server/platform/db.ts'

test('two plugins with the same tool name fail at boot', () => {
  const ping = defineTool({ description: 'Ping.', input: {}, run: async () => 'pong' })
  assert.throws(() => checked([definePlugin({ name: 'a', tools: { ping } }), definePlugin({ name: 'b', tools: { ping } })]), /Two plugins define the tool ping/)
})

test('every openhut tool comes from exactly one plugin', () => {
  const names = plugins().flatMap((plugin) => Object.keys(plugin.tools ?? {}))
  assert.equal(new Set(names).size, names.length)
  assert.equal(names.length, 17)
})

test('two plugins serving one route prefix fail at boot', () => {
  const routes = () => ({ '/api/things': async () => undefined })
  assert.throws(() => checked([definePlugin({ name: 'a', routes }), definePlugin({ name: 'b', routes })]), /Two plugins serve \/api\/things/)
})

test('migrate makes the core tables, then each plugin\'s, in list order', async () => {
  await migrate()
  await migrate()
  const tables = (await sql<{ name: string }>`select table_name as name from information_schema.tables where table_schema = 'public'`.execute(db)).rows.map((row) => row.name)
  for (const table of ['person', 'agent', 'record', 'channel', 'telegram_code', 'connection', 'connection_grant', 'connection_event', 'tool_permission', 'agent_secret', 'ask', 'inbox_source', 'inbox_item', 'github_face', 'github_thread']) assert.ok(tables.includes(table), table)
  const owners = plugins().filter((plugin) => plugin.migrate).map((plugin) => plugin.name)
  assert.deepEqual(owners, ['channels', 'connections', 'keys', 'asks', 'inbox', 'github'])
})

test('the plugins serve their own API routes', () => {
  const served = Object.fromEntries(plugins().filter((plugin) => plugin.routes).map((plugin) => [plugin.name, Object.keys(plugin.routes?.() ?? {})]))
  assert.deepEqual(served.inbox, ['/api/routines', '/api/webhooks', '/api/delivery-targets', '/inbox'])
  assert.deepEqual(served.chat, ['/api/threads'])
  assert.deepEqual(served.github, ['/api/agent-faces', '/api/github-app'])
  assert.ok(served.connections.includes('/api/grants'))
})
