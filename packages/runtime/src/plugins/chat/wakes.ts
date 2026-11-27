import { APP_PLATFORM, type Wake } from '../../core/plugin.ts'
import { wakes } from '../../core/wakes.ts'
import { db } from '../../server/platform/db.ts'
import { log } from '../../server/platform/events.ts'
import { messageOf } from '../../server/platform/http-error.ts'
import { LostTurn, threadService } from '../../server/threads/thread-service.ts'
import { inboxService } from '../../server/inbox/inbox-service.ts'
import { chat } from '../../server/chat/index.ts'

const TICK_MS = 15_000
const RETRY_MS = 30_000
const RETRIES = 20
const SERVER_SENDS = new Set([APP_PLATFORM, 'discord'])
const running = new Set<string>()
const again = new Set<string>()

export const runsOnServer = (wake: Wake): boolean => wake.origin.platform === APP_PLATFORM || (wake.id.startsWith('inbox:') && SERVER_SENDS.has(wake.origin.platform))

export function deliverAppWakes(): void {
  wakes.onNudge((agentId) => void deliver(agentId))
  const tick = () => void db.selectFrom('agent').select('id').where('wanted', '=', 'running').execute()
    .then((rows) => { for (const row of rows) void deliver(row.id) })
    .catch((err: unknown) => log.warn({ event: 'wake.tick_failed', error: messageOf(err) }))
  setInterval(tick, TICK_MS).unref()
  tick()
}

export async function deliver(agentId: string): Promise<void> {
  if (running.has(agentId)) {
    again.add(agentId)
    return
  }
  running.add(agentId)
  try {
    do {
      again.delete(agentId)
      for (const wake of (await wakes.due({ agentId })).filter(runsOnServer)) await run({ agentId, wake })
    } while (again.has(agentId))
  } catch (err) {
    log.warn({ event: 'wake.deliver_failed', agent: agentId, error: messageOf(err) })
  } finally {
    running.delete(agentId)
  }
}

async function run({ agentId, wake }: { agentId: string; wake: Wake }): Promise<void> {
  const item = wake.id.startsWith('inbox:') ? wake.id.slice('inbox:'.length) : undefined
  await wakes.report({ agentId, id: wake.id, body: { picked: true } })
  const { threadId, messageId, metadata } = item ? await inboxService.turnFor({ agentId, id: item }) : { threadId: await threadService.bySession({ agentId, session: wake.origin.chat_id }), messageId: undefined, metadata: undefined }
  for (let attempt = 0; ; attempt++) {
    try {
      const said = await threadService.runRoutine({ agentId, threadId, text: wake.text, metadata, messageId })
      await wakes.report({ agentId, id: wake.id, body: { said } })
      await chat.flush(threadId).catch((err: unknown) => log.warn({ event: 'wake.post_failed', agent: agentId, wake: wake.id, error: messageOf(err) }))
      return
    } catch (err) {
      log.warn({ event: 'wake.run_failed', agent: agentId, wake: wake.id, attempt, error: messageOf(err) })
      if (err instanceof LostTurn || attempt >= RETRIES) return
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS).unref())
    }
  }
}
