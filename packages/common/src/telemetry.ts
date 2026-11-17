import * as z from 'zod/mini'

export const TELEMETRY_EVENTS = {
  install_script_fetched: ['client'],
  release_downloaded: [],
  app_downloaded: ['platform'],
  setup_completed: ['owner_email'],
  instance_active: ['agents', 'people', 'owner_email'],
  agent_created: ['model'],
  agent_deleted: [],
  channel_connected: ['kind'],
  channel_removed: ['kind'],
  connection_created: ['kind'],
  person_invited: ['role'],
  person_joined: ['role'],
  skill_edited: [],
  skill_deleted: [],
  memory_edited: [],
  assistant_connected: ['client'],
  dashboard_page_viewed: ['page'],
  message_sent: ['channel', 'agent_name'],
} as const satisfies Record<string, readonly string[]>

export const BROWSER_EVENTS = ['dashboard_page_viewed'] as const
export const TELEMETRY_MAX_BATCH = 100

export type TelemetryName = keyof typeof TELEMETRY_EVENTS
export type TelemetryEvent = { name: TelemetryName; properties: Record<string, string | number>; at: number }
export type TelemetryBatch = { instance: string; version: string; events: TelemetryEvent[] }

export const TrackEvent = z.object({ name: z.enum(BROWSER_EVENTS), properties: z.record(z.string(), z.string().check(z.maxLength(32))) })
export type TrackEvent = z.infer<typeof TrackEvent>

const VALUE = /^[A-Za-z0-9][\w.+-]{0,31}$/
const MAX_COUNT = 10_000_000
const NAME = /^[^\u0000-\u001f\u007f]{1,64}$/
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/
const INSTANCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const VERSION = /^[\w.+-]{1,32}$/

export function isTelemetryName(name: string): name is TelemetryName {
  return Object.hasOwn(TELEMETRY_EVENTS, name)
}

export function telemetryEvent({ name, properties = {}, at = Date.now() }: { name: string; properties?: Record<string, unknown>; at?: number }): TelemetryEvent | undefined {
  if (!isTelemetryName(name)) return undefined
  const allowed: readonly string[] = TELEMETRY_EVENTS[name]
  const kept = allowed.flatMap((key): [string, string | number][] => {
    const value = properties[key]
    if (typeof value === 'number') return Number.isInteger(value) && value >= 0 && value <= MAX_COUNT ? [[key, value]] : []
    const pattern = patternOf(key)
    return typeof value === 'string' && pattern.test(value) ? [[key, value]] : []
  })
  return { name, properties: Object.fromEntries(kept), at: Number.isFinite(at) ? at : Date.now() }
}

export function telemetryBatch(value: unknown): TelemetryBatch | undefined {
  if (!isRecord(value) || !Array.isArray(value.events) || value.events.length > TELEMETRY_MAX_BATCH) return undefined
  const { instance, version } = value
  if (typeof instance !== 'string' || !INSTANCE.test(instance) || typeof version !== 'string' || !VERSION.test(version)) return undefined
  const events = value.events.flatMap((each) => {
    if (!isRecord(each) || typeof each.name !== 'string') return []
    const event = telemetryEvent({ name: each.name, properties: isRecord(each.properties) ? each.properties : {}, at: typeof each.at === 'number' ? each.at : undefined })
    return event ? [event] : []
  })
  return { instance, version, events }
}

function patternOf(key: string): RegExp {
  if (key.endsWith('_email')) return EMAIL
  if (key.endsWith('_name')) return NAME
  return VALUE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
