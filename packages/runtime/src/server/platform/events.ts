import { initLogger, log } from 'evlog'
import { config } from './config.ts'

initLogger({ env: { service: 'openhut', environment: config.build === 'dev' ? 'development' : 'production' }, pretty: process.stdout.isTTY === true, redact: true })

export { log }

type Target = { type: string; id: string; [field: string]: unknown }
export type AppEvent = { name: string; actor?: { id: string }; target?: Target; properties?: Record<string, unknown>; at?: number }

const LISTENERS: ((event: AppEvent) => void)[] = [logEvent]

export function emit(event: AppEvent): void {
  for (const listener of LISTENERS) {
    try {
      listener(event)
    } catch (error) {
      log.error({ event: 'event.listener_failed', name: event.name, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export function listen(listener: (event: AppEvent) => void): void {
  LISTENERS.push(listener)
}

function logEvent({ name, actor, target, properties }: AppEvent): void {
  log.info({ ...properties, event: name, actor: actor?.id, target })
}
