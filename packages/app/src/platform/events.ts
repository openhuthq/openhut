import { initLogger, log } from 'evlog'

initLogger({ env: { service: 'fastmonkey' }, pretty: process.stdout.isTTY === true, redact: true })

export { log }

export function record({ action, actor, target }: { action: string; actor: { id: string; username: string }; target: { type: string; id: string; [field: string]: unknown } }): void {
  log.info({ event: action, actor: actor.id, actorName: actor.username, target })
}
