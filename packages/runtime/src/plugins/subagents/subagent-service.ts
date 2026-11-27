import * as z from 'zod'
import type { Subagent } from '@openhut/common/agents/subagent.ts'
import { agentService } from '../../server/agents/agent-service.ts'
import type { Caller } from '../../server/team/identity.ts'
import { liveThreads } from '../../server/threads/live.ts'

const DONE_FOR_MS = 10_000
const STALE_MS = 60 * 60_000
const TITLE = 80


type Item = Subagent & { endedAt?: number }

const live = new Map<string, Map<string, Item>>()

export const subagentService = {
  started({ agentId, child, goal }: { agentId: string; child: string; goal: string }): undefined {
    const items = live.get(agentId) ?? new Map<string, Item>()
    live.set(agentId, items)
    items.set(child, { id: child, object: 'subagent', title: titleOf(goal), status: 'working', startedAt: new Date().toISOString() })
    publish(agentId)
    return undefined
  },

  stopped({ agentId, child, status }: { agentId: string; child: string; status: string }): undefined {
    const item = live.get(agentId)?.get(child)
    if (!item) return undefined
    item.status = status === 'completed' ? 'done' : 'failed'
    item.endedAt = Date.now()
    publish(agentId)
    if (item.status === 'done') setTimeout(() => publish(agentId), DONE_FOR_MS + 1).unref()
    return undefined
  },

  async list({ actor, agentId }: { actor: Caller; agentId: string }): Promise<Subagent[]> {
    await agentService.get({ actor, id: agentId })
    return current(agentId)
  },
}

function publish(agentId: string): void {
  liveThreads.subagents({ agentId, list: current(agentId) })
}

function current(agentId: string): Subagent[] {
  const items = live.get(agentId)
  if (!items) return []
  const now = Date.now()
  for (const [id, item] of items) {
    if (item.status === 'done' && now - (item.endedAt ?? now) > DONE_FOR_MS) items.delete(id)
    else if (now - Date.parse(item.startedAt) > STALE_MS) items.delete(id)
  }
  if (!items.size) live.delete(agentId)
  return [...items.values()].map(({ endedAt: _, ...item }) => item)
}

function titleOf(goal: string): string {
  const line = goal.trim().split('\n')[0] ?? ''
  return line.length > TITLE ? `${line.slice(0, TITLE - 1).trimEnd()}…` : line || 'Sub-agent'
}
