import * as z from 'zod'
import type { Subagent } from '@openhut/common/agents/subagent.ts'
import { agentService } from '../../server/agents/agent-service.ts'
import type { Caller } from '../../server/team/identity.ts'

const DONE_FOR_MS = 10_000
const STALE_MS = 60 * 60_000
const TITLE = 80

const Start = z.object({ child_session_id: z.string().min(1), child_goal: z.string().default('') })
const Stop = z.object({ child_session_id: z.string().min(1), child_status: z.string().nullish() })

type Item = Subagent & { endedAt?: number }

const live = new Map<string, Map<string, Item>>()

export const subagentService = {
  started({ agentId, args }: { agentId: string; args: Record<string, unknown> }): null {
    const found = Start.safeParse(args)
    if (!found.success) return null
    const items = live.get(agentId) ?? new Map<string, Item>()
    live.set(agentId, items)
    items.set(found.data.child_session_id, { id: found.data.child_session_id, object: 'subagent', title: titleOf(found.data.child_goal), status: 'working', startedAt: new Date().toISOString() })
    return null
  },

  stopped({ agentId, args }: { agentId: string; args: Record<string, unknown> }): null {
    const found = Stop.safeParse(args)
    const item = found.success ? live.get(agentId)?.get(found.data.child_session_id) : undefined
    if (!found.success || !item) return null
    item.status = found.data.child_status === 'completed' ? 'done' : 'failed'
    item.endedAt = Date.now()
    return null
  },

  async list({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Subagent[]> {
    await agentService.get({ actor, id: agentId })
    const items = live.get(agentId)
    if (!items) return []
    const now = Date.now()
    for (const [id, item] of items) {
      if (item.status === 'done' && now - (item.endedAt ?? now) > DONE_FOR_MS) items.delete(id)
      else if (now - Date.parse(item.startedAt) > STALE_MS) items.delete(id)
    }
    if (!items.size) live.delete(agentId)
    return [...items.values()].map(({ endedAt: _, ...item }) => item)
  },
}

function titleOf(goal: string): string {
  const line = goal.trim().split('\n')[0] ?? ''
  return line.length > TITLE ? `${line.slice(0, TITLE - 1).trimEnd()}…` : line || 'Sub-agent'
}
