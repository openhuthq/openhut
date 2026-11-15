import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { messagingActivity } from '../src/activity.ts'

const dir = mkdtempSync(`${tmpdir()}/activity-`)
const now = 1_800_000_000

function stateDb(name: string, rows: [string, string | null, string, number][]): string {
  const file = `${dir}/${name}.db`
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT); CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT NOT NULL, content TEXT, timestamp REAL NOT NULL)')
  rows.forEach(([source, user, role, at], i) => {
    db.prepare('INSERT OR IGNORE INTO sessions (id, source, user_id) VALUES (?, ?, ?)').run(`${source}-${user}`, source, user)
    db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)').run(`${source}-${user}`, role, `secret ${i}`, at)
  })
  db.close()
  return file
}

test('counts messages from people per channel, distinct senders across agents, and agents that got any', () => {
  const ops = stateDb('ops', [['slack', 'U1', 'user', now], ['slack', 'U1', 'assistant', now], ['slack', 'U2', 'user', now], ['whatsapp', '4915', 'user', now - 200_000]])
  const support = stateDb('support', [['slack', 'U1', 'user', now], ['api_server', null, 'user', now]])
  const quiet = stateDb('quiet', [['telegram', 'T1', 'user', now - 200_000]])
  assert.deepEqual(messagingActivity({ files: [ops, support, quiet, `${dir}/missing.db`], since: now - 86_400 }), { messages: { slack: 3, api_server: 1 }, senders: 2, agents: 2 })
})
