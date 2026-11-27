import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { newMessages } from '../../src/agentd/hermes-db.ts'

const dir = mkdtempSync(`${tmpdir()}/messages-`)

function stateDb(name: string, rows: [string, string, number][]): string {
  const file = `${dir}/${name}.db`
  const db = new DatabaseSync(file)
  db.exec('CREATE TABLE sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, user_id TEXT); CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT NOT NULL, content TEXT, timestamp REAL NOT NULL)')
  rows.forEach(([source, role, at], i) => {
    db.prepare('INSERT OR IGNORE INTO sessions (id, source, user_id) VALUES (?, ?, ?)').run(source, source, `person-${i}`)
    db.prepare('INSERT INTO messages (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)').run(source, role, `secret ${i}`, at)
  })
  db.close()
  return file
}

test('returns only the agent, channel and time of each new message from a person, across agents, oldest first', () => {
  const ops = stateDb('ops', [['slack', 'user', 100], ['slack', 'assistant', 101], ['slack', 'user', 205.5], ['whatsapp', 'user', 300]])
  const support = stateDb('support', [['api_server', 'user', 250], ['telegram', 'tool', 260]])
  assert.deepEqual(newMessages({ agents: [{ id: 'ag_ops00000', file: ops }, { id: 'ag_supp0000', file: support }, { id: 'ag_gone0000', file: `${dir}/missing.db` }], since: 100 }), [
    { agentId: 'ag_ops00000', source: 'slack', at: 205.5 }, { agentId: 'ag_supp0000', source: 'api_server', at: 250 }, { agentId: 'ag_ops00000', source: 'whatsapp', at: 300 },
  ])
})

test('a full page stops before the last timestamp, so messages that share it come in the next read', () => {
  const busy = stateDb('busy', [...Array.from({ length: 999 }, (): [string, string, number] => ['slack', 'user', 10]), ['slack', 'user', 20], ['slack', 'user', 20]])
  const first = newMessages({ agents: [{ id: 'ag_busy0000', file: busy }], since: 0 })
  assert.equal(first.length, 999)
  assert.equal(newMessages({ agents: [{ id: 'ag_busy0000', file: busy }], since: first.at(-1)?.at ?? 0 }).length, 2)
})
