import { wakes } from '../../../src/core/wakes.ts'
import { deliver } from '../../../src/plugins/chat/wakes.ts'
import { threadService } from '../../../src/server/threads/thread-service.ts'

export function appWakes({ reply = async () => '' }: { reply?: (input: { agentId: string; text: string }) => Promise<string> } = {}) {
  const told: { agentId: string; text: string }[] = []
  const pending: Promise<void>[] = []
  threadService.runRoutine = async ({ agentId, text }) => {
    told.push({ agentId, text })
    return reply({ agentId, text })
  }
  wakes.onNudge((agentId) => { pending.push(deliver(agentId)) })
  return {
    told,
    deliver: (agentId: string) => { pending.push(deliver(agentId)) },
    settled: async () => { while (pending.length) await pending.shift() },
  }
}
