import { initLogger, log } from 'evlog'
import { TELEMETRY_MAX_BATCH, telemetryEvent, type TelemetryEvent } from '@openhut/common/telemetry.ts'
import { config } from './config.ts'

initLogger({ env: { service: 'openhut' }, pretty: process.stdout.isTTY === true, redact: true })

export { log }

type Target = { type: string; id: string; [field: string]: unknown }
export type AppEvent = { name: string; actor?: { id: string; email: string }; target?: Target; properties?: Record<string, unknown>; at?: number }

const MAX_QUEUE = 500
const queue: TelemetryEvent[] = []
let usageOn = true
const TELEMETRY_OF: Record<string, (event: AppEvent) => [string, Record<string, unknown>]> = {
  'app.started': () => ['app_started', {}],
  'setup.completed': () => ['setup_completed', {}],
  'instance.active': ({ properties }) => ['instance_active', properties ?? {}],
  'message.sent': ({ properties }) => ['message_sent', properties ?? {}],
  'dashboard.page_viewed': ({ properties }) => ['dashboard_page_viewed', properties ?? {}],
  'agent.created': ({ target }) => ['agent_created', { model: target?.model }],
  'agent.deleted': () => ['agent_deleted', {}],
  'channel.created': ({ target }) => ['channel_connected', { kind: target?.kind }],
  'channel.deleted': ({ target }) => ['channel_removed', { kind: target?.kind }],
  'connection.created': ({ target }) => ['connection_created', { kind: target?.kind }],
  'skill.updated': () => ['skill_edited', {}],
  'skill.deleted': () => ['skill_deleted', {}],
  'memory.updated': () => ['memory_edited', {}],
}
const LISTENERS: ((event: AppEvent) => void)[] = [logEvent, queueTelemetry]

export function emit(event: AppEvent): void {
  for (const listener of LISTENERS) listener(event)
}

function logEvent({ name, actor, target, properties }: AppEvent): void {
  log.info({ ...properties, event: name, actor: actor?.id, actorName: actor?.email, target })
}

function queueTelemetry(event: AppEvent): void {
  const mapped = TELEMETRY_OF[event.name]?.(event)
  if (!mapped || !usageDataOn() || queue.length >= MAX_QUEUE) return
  const sent = telemetryEvent({ name: mapped[0], properties: withoutEmails(mapped[1]), at: event.at })
  if (sent) queue.push(sent)
}

export function usageDataOn(): boolean {
  return config.telemetry && usageOn
}

export function setUsageData(on: boolean): void {
  usageOn = on
  if (!on) queue.length = 0
}

export function takeTelemetry(): TelemetryEvent[] {
  return queue.splice(0, TELEMETRY_MAX_BATCH)
}

function withoutEmails(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).filter(([key]) => !key.endsWith('_email')))
}
