import { setTimeout as sleep } from 'node:timers/promises'
import { durable } from '../../core/durable.ts'
import { emit, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'

const SETTLE_MS = 20_000
const applying = new Set<string>()
const errors = new Map<string, string>()
let settle: (agentId: string) => Promise<void> = async () => undefined

const task = durable<{ agentId: string }>('agent-apply', 'latest', async ({ agentId }, { last }) => {
  applying.add(agentId)
  try {
    await settle(agentId)
  } catch (err) {
    log.warn({ event: 'apply.try_failed', agent: agentId, last, error: messageOf(err) })
    if (!last) throw err
    applying.delete(agentId)
    errors.set(agentId, err instanceof HttpError ? err.message : 'Something went wrong while applying it.')
    emit({ name: 'agent.apply_failed', target: { type: 'agent', id: agentId } })
    throw err
  }
  applying.delete(agentId)
  errors.delete(agentId)
  emit({ name: 'agent.applied', target: { type: 'agent', id: agentId } })
})

export const apply = {
  use(run: (agentId: string) => Promise<void>): void {
    settle = run
  },

  async request(agentId: string): Promise<void> {
    applying.add(agentId)
    errors.delete(agentId)
    await task.send(agentId, { agentId })
    emit({ name: 'agent.applying', target: { type: 'agent', id: agentId } })
  },

  state: (agentId: string): { applying: boolean; applyError: string | null } => ({ applying: applying.has(agentId), applyError: errors.get(agentId) ?? null }),

  async settled(agentId: string): Promise<void> {
    const until = Date.now() + SETTLE_MS
    while (applying.has(agentId) && Date.now() < until) await sleep(200)
  },
}
