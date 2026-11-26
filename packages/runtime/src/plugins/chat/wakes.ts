import { APP_PLATFORM, type Wake } from '../../core/plugin.ts'
import { wakes } from '../../core/wakes.ts'
import { db } from '../../server/platform/db.ts'
import { log } from '../../server/platform/events.ts'
import { messageOf } from '../../server/platform/http-error.ts'
import { threadService } from '../../server/threads/thread-service.ts'

const TICK_MS = 15_000
const RETRY_MS = 30_000
const RETRIES = 20
const running = new Set<string>()
const again = new Set<string>()

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
      for (const wake of (await wakes.due({ agentId })).filter((each) => each.origin.platform === APP_PLATFORM)) await run({ agentId, wake })
    } while (again.has(agentId))
  } catch (err) {
    log.warn({ event: 'wake.deliver_failed', agent: agentId, error: messageOf(err) })
  } finally {
    running.delete(agentId)
  }
}

async function run({ agentId, wake }: { agentId: string; wake: Wake }): Promise<void> {
  await wakes.report({ agentId, id: wake.id, body: { picked: true } })
  for (let attempt = 0; ; attempt++) {
    try {
      const said = await threadService.runRoutine({ agentId, text: wake.text })
      await wakes.report({ agentId, id: wake.id, body: { said } })
      return
    } catch (err) {
      log.warn({ event: 'wake.run_failed', agent: agentId, wake: wake.id, attempt, error: messageOf(err) })
      if (attempt >= RETRIES) return
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS).unref())
    }
  }
}
