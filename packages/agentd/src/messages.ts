import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export type NewMessage = { agentId: string; source: string; at: number }

const PER_AGENT = 1000
const SQL = 'SELECT s.source AS source, m.timestamp AS at FROM messages m JOIN sessions s ON s.id = m.session_id WHERE m.role = \'user\' AND m.timestamp > ? ORDER BY m.timestamp LIMIT ?'

export function newMessages({ agents, since }: { agents: { id: string; file: string }[]; since: number }): NewMessage[] {
  const found: NewMessage[] = []
  for (const { id, file } of agents.filter((each) => existsSync(each.file))) {
    try {
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        for (const row of db.prepare(SQL).all(since, PER_AGENT)) found.push({ agentId: id, source: String(row.source), at: Number(row.at) })
      } finally {
        db.close()
      }
    } catch (error) {
      console.error(`messages ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return found.sort((a, b) => a.at - b.at)
}
