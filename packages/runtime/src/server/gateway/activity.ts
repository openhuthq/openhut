import { setTimeout as sleep } from 'node:timers/promises'
import { log } from '../platform/events.ts'

const TURN_MS = 15 * 60_000
const open = new Map<string, number>()
const lastSeen = new Map<string, number>()
const turns = new Map<string, Map<string, number>>()

export const activity = {
  count(agentId: string): number {
    return open.get(agentId) ?? 0
  },

  started(agentId: string): void {
    open.set(agentId, activity.count(agentId) + 1)
    lastSeen.set(agentId, Date.now())
  },

  ended(agentId: string): void {
    open.set(agentId, Math.max(0, activity.count(agentId) - 1))
    lastSeen.set(agentId, Date.now())
  },

  turn({ agentId, turn, state }: { agentId: string; turn: string; state: 'start' | 'end' }): void {
    const running = turns.get(agentId) ?? new Map<string, number>()
    if (state === 'start') running.set(turn, Date.now())
    else running.delete(turn)
    turns.set(agentId, running)
    lastSeen.set(agentId, Date.now())
  },

  inTurn(agentId: string): boolean {
    const running = turns.get(agentId)
    for (const [turn, at] of running ?? []) if (Date.now() - at > TURN_MS) running?.delete(turn)
    return !!running?.size
  },

  // Any agent with a gateway call open, or one that ended less than `ms` ago.
  recent(ms: number): boolean {
    return [...open.values()].some((count) => count > 0) || [...lastSeen.values()].some((at) => Date.now() - at < ms)
  },

  async quiet({ agentId, ms, most = 600_000 }: { agentId: string; ms: number; most?: number }): Promise<void> {
    const until = Date.now() + most
    const busy = () => activity.inTurn(agentId) || activity.count(agentId) > 0 || Date.now() - (lastSeen.get(agentId) ?? 0) < ms
    while (Date.now() < until && busy()) await sleep(1000)
    if (busy()) log.warn({ event: 'agent.quiet_wait_ended', agent: agentId, ms: most })
  },
}
