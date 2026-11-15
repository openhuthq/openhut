import { randomUUID } from 'node:crypto'
import { agentd } from './agentd.ts'
import { config } from './config.ts'
import { db } from './db.ts'
import type { TelemetryEvent } from '@openhut/common/telemetry.ts'
import { log, setUsageData, takeTelemetry, track, usageDataOn } from './events.ts'
import { settings } from './settings.ts'

const SEND_EVERY_MS = 60_000
const FIRST_ACTIVE_MS = 5 * 60_000
const DAY_MS = 24 * 60 * 60_000
const SEND_TIMEOUT_MS = 10_000
const MAX_BATCHES_PER_SEND = 5
const AGENT_BUCKETS: [number, string][] = [[0, '0'], [1, '1'], [5, '2-5'], [Infinity, '6+']]
const CHANNELS = ['slack', 'whatsapp', 'telegram']
const PEOPLE_BUCKETS: [number, string][] = [[1, '1'], [5, '2-5'], [20, '6-20'], [Infinity, '21+']]

export async function startTelemetry(): Promise<void> {
  setUsageData(settings.usageData())
  if (!config.telemetry) return
  const instance = settings.instanceId() ?? await settings.setInstanceId(randomUUID())
  log.info({ event: 'telemetry.started', url: config.telemetryUrl, on: usageDataOn(), hint: 'Turn usage data on or off in Admin.' })
  setInterval(() => void sendTelemetry(instance), SEND_EVERY_MS).unref()
  let since = Date.now() / 1000
  setInterval(() => void reportMessages(since).then((next) => { since = next }), SEND_EVERY_MS).unref()
  setTimeout(() => void reportActive(), FIRST_ACTIVE_MS).unref()
  setInterval(() => void reportActive(), DAY_MS).unref()
}

export async function sendTelemetry(instance: string): Promise<void> {
  for (let batch = 0; batch < MAX_BATCHES_PER_SEND; batch++) {
    const events = takeTelemetry()
    if (!events.length) return
    await sendBatch({ instance, events })
  }
}

async function sendBatch({ instance, events }: { instance: string; events: TelemetryEvent[] }): Promise<void> {
  try {
    const response = await fetch(config.telemetryUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      body: JSON.stringify({ instance, version: config.version, events }),
    })
    if (!response.ok) throw new Error(`openhut.dev answered ${response.status}`)
  } catch (error) {
    log.warn({ event: 'telemetry.send_failed', dropped: events.length, error: error instanceof Error ? error.message : String(error) })
  }
}

export async function reportActive(): Promise<void> {
  if (!usageDataOn()) return
  const [agents, people, owner] = await Promise.all([
    db.selectFrom('agent').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    db.selectFrom('person').select((eb) => eb.fn.countAll<number>().as('n')).where('removed_at', 'is', null).executeTakeFirstOrThrow(),
    db.selectFrom('person').select('email').where('role', '=', 'owner').where('removed_at', 'is', null).executeTakeFirst(),
  ])
  track('instance_active', { agents: bucketOf(Number(agents.n), AGENT_BUCKETS), people: bucketOf(Number(people.n), PEOPLE_BUCKETS), owner_email: owner?.email })
}

export async function reportMessages(since: number): Promise<number> {
  if (!usageDataOn()) return Date.now() / 1000
  const found = await agentd.newMessages({ since }).catch(() => undefined)
  if (!found) return since
  const ids = [...new Set(found.messages.map((message) => message.agentId))]
  const rows = ids.length ? await db.selectFrom('agent').select(['id', 'name']).where('id', 'in', ids).execute() : []
  const names = new Map(rows.map((row) => [row.id, row.name]))
  for (const message of found.messages) track('message_sent', { channel: channelOf(message.source), agent_name: names.get(message.agentId) }, Math.round(message.at * 1000))
  return found.messages.at(-1)?.at ?? since
}

function channelOf(source: string): string {
  if (CHANNELS.includes(source)) return source
  if (source.startsWith('api')) return 'dashboard'
  return 'other'
}

function bucketOf(count: number, buckets: [number, string][]): string {
  return buckets.find(([max]) => count <= max)?.[1] ?? buckets[buckets.length - 1][1]
}
