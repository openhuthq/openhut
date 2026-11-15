import { initLogger, log } from 'evlog'

initLogger({ env: { service: 'openhut' }, pretty: process.stdout.isTTY === true, redact: true })

export { log }

export function record({ action, actor, target }: { action: string; actor: { id: string; email: string }; target: { type: string; id: string; [field: string]: unknown } }): void {
  log.info({ event: action, actor: actor.id, actorName: actor.email, target })
}
