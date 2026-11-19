import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { errorText } from './util.ts'

export type NewMessage = { agentId: string; source: string; at: number }
type Agents = { id: string; file: string }[]

const PER_AGENT = 1000
const SQL = 'SELECT s.source AS source, m.timestamp AS at FROM messages m JOIN sessions s ON s.id = m.session_id WHERE m.role = \'user\' AND m.timestamp > ? ORDER BY m.timestamp LIMIT ?'
const COST = 'SELECT COALESCE(SUM(estimated_cost_usd), 0) AS cost FROM sessions WHERE COALESCE(last_activity_at, started_at) >= ?'

export function newMessages({ agents, since }: { agents: Agents; since: number }): NewMessage[] {
  const found: NewMessage[] = []
  for (const { id, file } of agents) {
    for (const row of query(file, (db) => db.prepare(SQL).all(since, PER_AGENT)) ?? []) found.push({ agentId: id, source: String(row.source), at: Number(row.at) })
  }
  return found.sort((a, b) => a.at - b.at)
}

export function usage({ agents, since }: { agents: Agents; since: number }): Record<string, number> {
  const costs: Record<string, number> = {}
  for (const { id, file } of agents) {
    const cost = query(file, (db) => Number(db.prepare(COST).get(since)?.cost ?? 0))
    if (cost !== undefined) costs[id] = cost
  }
  return costs
}

function query<T>(file: string, read: (db: DatabaseSync) => T): T | undefined {
  if (!existsSync(file)) return undefined
  try {
    const db = new DatabaseSync(file, { readOnly: true })
    try {
      return read(db)
    } finally {
      db.close()
    }
  } catch (e) {
    console.error(`${file}: ${errorText(e)}`)
    return undefined
  }
}
