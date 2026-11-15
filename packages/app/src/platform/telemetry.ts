import { randomUUID } from 'node:crypto'
import { config } from './config.ts'
import { db } from './db.ts'
import { log, takeTelemetry, track } from './events.ts'
import { settings } from './settings.ts'

const SEND_EVERY_MS = 60_000
const FIRST_ACTIVE_MS = 5 * 60_000
const DAY_MS = 24 * 60 * 60_000
const SEND_TIMEOUT_MS = 10_000
const AGENT_BUCKETS: [number, string][] = [[0, '0'], [1, '1'], [5, '2-5'], [Infinity, '6+']]
const PEOPLE_BUCKETS: [number, string][] = [[1, '1'], [5, '2-5'], [20, '6-20'], [Infinity, '21+']]

export async function startTelemetry(): Promise<void> {
  if (!config.telemetry) return
  const instance = settings.instanceId() ?? await settings.setInstanceId(randomUUID())
  log.info({ event: 'telemetry.on', url: config.telemetryUrl, hint: 'Set OPENHUT_TELEMETRY=off in /etc/openhut/env to stop it.' })
  setInterval(() => void sendTelemetry(instance), SEND_EVERY_MS).unref()
  setTimeout(() => void reportActive(), FIRST_ACTIVE_MS).unref()
  setInterval(() => void reportActive(), DAY_MS).unref()
}

export async function sendTelemetry(instance: string): Promise<void> {
  const events = takeTelemetry()
  if (!events.length) return
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
  const [agents, people, owner] = await Promise.all([
    db.selectFrom('agent').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirstOrThrow(),
    db.selectFrom('person').select((eb) => eb.fn.countAll<number>().as('n')).where('removed_at', 'is', null).executeTakeFirstOrThrow(),
    db.selectFrom('person').select('email').where('role', '=', 'owner').where('removed_at', 'is', null).executeTakeFirst(),
  ])
  track('instance_active', { agents: bucketOf(Number(agents.n), AGENT_BUCKETS), people: bucketOf(Number(people.n), PEOPLE_BUCKETS), owner_email: owner?.email })
}

function bucketOf(count: number, buckets: [number, string][]): string {
  return buckets.find(([max]) => count <= max)?.[1] ?? buckets[buckets.length - 1][1]
}
