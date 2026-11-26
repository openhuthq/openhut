import type { Selectable } from 'kysely'
import type { ConnectionEvent, ListConnectionEvents } from '@openhut/common/connections/connection.ts'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { HttpError } from '../platform/http-error.ts'
import { agentService } from '../agents/agent-service.ts'
import type { Caller } from '../team/identity.ts'

const DEFAULT_LIMIT = 10

export const connectionEventService = {
  async list({ actor, query }: { actor: Caller; query: ListConnectionEvents }): Promise<{ data: ConnectionEvent[]; hasMore: boolean }> {
    if (!query.connectionId && !query.agentId) throw new HttpError(400, 'Pass a connectionId or an agentId to list its calls.', { param: 'connectionId' })
    if (query.agentId) await requireReadableAgent({ actor, agentId: query.agentId })
    const limit = query.limit ?? DEFAULT_LIMIT
    let select = db.selectFrom('connection_event as e').leftJoin('agent as a', 'a.id', 'e.agent_id').leftJoin('person as p', 'p.id', 'e.approved_by')
      .select(['e.id', 'e.at', 'e.connection_id', 'e.agent_id', 'a.name', 'e.tool', 'e.reason', 'e.outcome', 'e.ms', 'e.approved_by', 'p.name as approver', 'p.email as approver_email'])
      .orderBy('e.id', 'desc').limit(limit + 1)
    if (query.connectionId) select = select.where('e.connection_id', '=', query.connectionId)
    if (query.agentId) select = select.where('e.agent_id', '=', query.agentId)
    if (query.startingAfter) select = select.where('e.id', '<', query.startingAfter)
    const rows = await select.execute()
    return { data: rows.slice(0, limit).map(eventOf), hasMore: rows.length > limit }
  },
}

async function requireReadableAgent({ actor, agentId }: { actor: Caller; agentId: string }): Promise<void> {
  const exists = await db.selectFrom('agent').select('id').where('id', '=', agentId).executeTakeFirst()
  if (!exists) return
  await agentService.requireUse({ actor, id: agentId })
}

function eventOf(row: Pick<Selectable<Database['connection_event']>, 'id' | 'at' | 'connection_id' | 'agent_id' | 'tool' | 'reason' | 'outcome' | 'ms' | 'approved_by'> & { name: string | null; approver: string | null; approver_email: string | null }): ConnectionEvent {
  return {
    id: String(row.id), object: 'connection_event', at: new Date(row.at).toISOString(), connectionId: row.connection_id, agentId: row.agent_id,
    agentName: row.name ?? 'deleted agent', tool: row.tool, reason: row.reason, outcome: row.outcome, approvedBy: row.approved_by ? row.approver || row.approver_email || 'someone' : null, ms: row.ms,
  }
}
