import { setTimeout as sleep } from 'node:timers/promises'

const open = new Map<string, number>()
const lastSeen = new Map<string, number>()

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

  // Any agent with a gateway call open, or one that ended less than `ms` ago.
  recent(ms: number): boolean {
    return [...open.values()].some((count) => count > 0) || [...lastSeen.values()].some((at) => Date.now() - at < ms)
  },

  async quiet({ agentId, ms, most = 600_000 }: { agentId: string; ms: number; most?: number }): Promise<void> {
    const until = Date.now() + most
    while (Date.now() < until && (activity.count(agentId) > 0 || Date.now() - (lastSeen.get(agentId) ?? 0) < ms)) await sleep(1000)
  },
}
