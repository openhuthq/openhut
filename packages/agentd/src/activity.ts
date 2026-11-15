import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export type Activity = { messages: Record<string, number>; senders: number; agents: number }

const SQL = 'SELECT s.source AS source, s.user_id AS sender, COUNT(*) AS n FROM messages m JOIN sessions s ON s.id = m.session_id WHERE m.role = \'user\' AND m.timestamp >= ? GROUP BY s.source, s.user_id'

export function messagingActivity({ files, since }: { files: string[]; since: number }): Activity {
  const messages: Record<string, number> = {}
  const senders = new Set<string>()
  let agents = 0
  for (const file of files.filter((each) => existsSync(each))) {
    let seen = false
    try {
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        for (const row of db.prepare(SQL).all(since)) {
          const source = String(row.source)
          messages[source] = (messages[source] ?? 0) + Number(row.n)
          if (row.sender !== null && row.sender !== undefined) senders.add(`${source}:${String(row.sender)}`)
          seen = true
        }
      } finally {
        db.close()
      }
    } catch (error) {
      console.error(`activity ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (seen) agents += 1
  }
  return { messages, senders: senders.size, agents }
}
