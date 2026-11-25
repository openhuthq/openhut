import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AS_ROOT, box, ID } from './host.ts'
import { FIREWALL } from './sandbox/docker.ts'
import { errorText, EXEC } from './util.ts'

const run = promisify(execFile)
const FRESH_MS = 5_000
const WATCHDOG_MS = 30_000

let last = { at: 0, on: false }
let pending: Promise<Readiness> | undefined

export const firewall = {
  watch(): void {
    if (box.name === 'docker' && AS_ROOT) setInterval(() => watch().catch((e) => console.error(`watchdog: ${errorText(e)}`)), WATCHDOG_MS)
  },

  async recent(): Promise<boolean> {
    if (Date.now() - last.at < FRESH_MS) return last.on
    return (await check()).ok
  },

  async require(): Promise<void> {
    const ready = await check()
    if (!ready.ok) throw new Error(`${ready.reason ?? 'the sandbox is not ready'}; refusing to run agents`)
  },
}

async function watch() {
  if ((await check()).ok) return
  await run(FIREWALL, [], EXEC).catch((e) => console.error(`watchdog: firewall re-apply failed: ${errorText(e)}`))
  if ((await check()).ok) {
    console.log(`watchdog: re-applied the firewall at ${new Date().toISOString()}`)
    return
  }
  const running = (await box.list().catch(() => [])).filter((each) => ID.test(each.id) && each.running)
  await Promise.all(running.map((each) => box.stop({ id: each.id, seconds: 5 }).catch((e) => console.error(`watchdog: stop failed: ${errorText(e)}`))))
  console.error(`watchdog: firewall missing; stopped ${running.length} agents at ${new Date().toISOString()}`)
}

function check(): Promise<Readiness> {
  pending ??= box.ready()
    .catch((e: unknown) => ({ ok: false, reason: errorText(e) }))
    .then((ready) => {
      last = { at: Date.now(), on: ready.ok }
      return ready
    })
    .finally(() => {
      pending = undefined
    })
  return pending
}

type Readiness = { ok: boolean; reason?: string }
