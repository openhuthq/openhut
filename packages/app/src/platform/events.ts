import { initLogger, log } from 'evlog'
import { TELEMETRY_MAX_BATCH, telemetryEvent, type TelemetryEvent } from '@openhut/common/telemetry.ts'
import { config } from './config.ts'

initLogger({ env: { service: 'openhut' }, pretty: process.stdout.isTTY === true, redact: true })

export { log }

type Target = { type: string; id: string; [field: string]: unknown }

const MAX_QUEUE = 500
const queue: TelemetryEvent[] = []
let usageOn = true
const ASSISTANTS = ['claude', 'cursor', 'codex', 'windsurf', 'zed']
const TELEMETRY_OF: Record<string, (target: Target, actor: { email: string }) => [string, Record<string, unknown>]> = {
  'agent.created': (target) => ['agent_created', { model: target.model }],
  'agent.deleted': () => ['agent_deleted', {}],
  'channel.created': (target) => ['channel_connected', { kind: target.kind }],
  'channel.deleted': (target) => ['channel_removed', { kind: target.kind }],
  'connection.created': (target) => ['connection_created', { kind: target.kind }],
  'invite.created': (target) => ['person_invited', { role: target.role }],
  'person.joined': (target, actor) => target.role === 'owner' ? ['setup_completed', { owner_email: actor.email }] : ['person_joined', { role: target.role }],
  'skill.updated': () => ['skill_edited', {}],
  'skill.deleted': () => ['skill_deleted', {}],
  'memory.updated': () => ['memory_edited', {}],
  'oauth.app_connected': (target) => ['assistant_connected', { client: assistantOf(target.name) }],
}

export function record({ action, actor, target }: { action: string; actor: { id: string; email: string }; target: Target }): void {
  log.info({ event: action, actor: actor.id, actorName: actor.email, target })
  const mapped = TELEMETRY_OF[action]?.(target, actor)
  if (mapped) track(mapped[0], mapped[1])
}

export function track(name: string, properties: Record<string, unknown> = {}, at?: number): void {
  if (!usageDataOn() || queue.length >= MAX_QUEUE) return
  const event = telemetryEvent({ name, properties, at })
  if (event) queue.push(event)
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

function assistantOf(name: unknown): string {
  const lower = typeof name === 'string' ? name.toLowerCase() : ''
  return ASSISTANTS.find((assistant) => lower.includes(assistant)) ?? 'other'
}
