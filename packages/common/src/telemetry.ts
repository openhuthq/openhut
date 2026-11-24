export const TELEMETRY_EVENTS = {
  install_script_fetched: ['client'],
  release_downloaded: [],
  app_downloaded: ['platform', 'location'],
  app_started: [],
  setup_completed: [],
  instance_active: ['agents'],
  agent_created: ['model'],
  agent_deleted: [],
  channel_connected: ['kind'],
  channel_removed: ['kind'],
  connection_created: ['kind'],
  skill_edited: [],
  skill_deleted: [],
  memory_edited: [],
  dashboard_page_viewed: ['page'],
  message_sent: ['channel', 'agent_name'],
  download_clicked: ['platform', 'location'],
  github_clicked: ['location'],
} as const satisfies Record<string, readonly string[]>

export const TELEMETRY_MAX_BATCH = 100
// What a browser on openhut.dev may send without an instance (private/site/public/track.js).
export const BROWSER_EVENTS: readonly TelemetryName[] = ['download_clicked', 'github_clicked']
export const INSTALL_KINDS = ['mac', 'linux', 'server'] as const

export type TelemetryName = keyof typeof TELEMETRY_EVENTS
export type TelemetryEvent = { name: TelemetryName; properties: Record<string, string | number>; at: number }
export type InstallKind = typeof INSTALL_KINDS[number]
// From an install: instance and version. openhut.dev (site: true, with the Cloud's stats token) may also send none, and adds the sender's country.
export type TelemetryBatch = { instance?: string; version?: string; kind?: InstallKind; country?: string; events: TelemetryEvent[] }

// What telemetryService.stats() returns on the Cloud; the owner-only admin page (cloud.openhut.dev/api/v1/admin) shows it.
export type Stats = {
  installs: number
  activeToday: number
  countries: number
  messages: number
  downloads: number
  kinds: { kind: string; n: number }[]
  channels: { channel: string; n: number }[]
  places: { country: string; n: number }[]
  active: { day: string; n: number }[]
  newInstalls: { day: string; n: number }[]
  messagesByDay: { day: string; n: number }[]
  downloadPresses: { key: string; n: number }[]
  events: { day: string; name: string; n: number }[]
}

const VALUE = /^[A-Za-z0-9][\w.+-]{0,31}$/
const MAX_COUNT = 10_000_000
const MAX_AGE_MS = 30 * 86_400_000
const MAX_AHEAD_MS = 3_600_000
const NAME = /^[^\u0000-\u001f\u007f]{1,64}$/
const INSTANCE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const VERSION = /^[\w.+-]{1,32}$/
const COUNTRY = /^[A-Z]{2}$/

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
  const now = Date.now()
  if (!Number.isFinite(at) || at < now - MAX_AGE_MS || at > now + MAX_AHEAD_MS) return undefined
  return { name, properties: Object.fromEntries(kept), at: Math.trunc(at) }
}

export function telemetryBatch(value: unknown, { site = false }: { site?: boolean } = {}): TelemetryBatch | undefined {
  if (!isRecord(value) || !Array.isArray(value.events) || value.events.length > TELEMETRY_MAX_BATCH) return undefined
  const { instance, version, country } = value
  const anonymous = site && instance === undefined && version === undefined
  if (!anonymous && (typeof instance !== 'string' || !INSTANCE.test(instance) || typeof version !== 'string' || !VERSION.test(version))) return undefined
  const kind = INSTALL_KINDS.find((each) => each === value.kind)
  const events = value.events.flatMap((each) => {
    if (!isRecord(each) || typeof each.name !== 'string') return []
    const event = telemetryEvent({ name: each.name, properties: isRecord(each.properties) ? each.properties : {}, at: typeof each.at === 'number' ? each.at : undefined })
    return event ? [event] : []
  })
  return {
    ...(!anonymous && { instance, version }),
    ...(kind && { kind }),
    ...(site && typeof country === 'string' && COUNTRY.test(country) && { country }),
    events,
  }
}

function patternOf(key: string): RegExp {
  if (key.endsWith('_name')) return NAME
  return VALUE
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
