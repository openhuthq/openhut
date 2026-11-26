import { wakes } from '../../../src/core/wakes.ts'
import { deliver } from '../../../src/plugins/chat/wakes.ts'
import { threadService } from '../../../src/server/threads/thread-service.ts'
import { agentService } from '../../../src/server/agents/agent-service.ts'
import { db } from '../../../src/server/platform/db.ts'

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
    settled: async () => {
      for (;;) {
        while (pending.length) await pending.shift()
        const ids = (await db.selectFrom('agent').select('id').execute()).map((row) => row.id)
        if (!ids.some((id) => agentService.restartPending(id)) && !pending.length) return
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    },
  }
}
