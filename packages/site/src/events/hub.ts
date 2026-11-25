import { BROWSER_EVENTS, telemetryBatch, type TelemetryBatch } from '@openhut/common/telemetry.ts'

// The store of record is the Cloud: this Worker hands it every event (the owner reads them on cloud.openhut.dev/api/v1/admin).
const CLOUD = 'https://cloud.openhut.dev/api'
const LIVE_HOSTS = new Set(['openhut.dev', 'www.openhut.dev', 'cloud.openhut.dev'])
const MAX_BODY = 64_000

export type HubEnv = { STATS_TOKEN?: string; CLOUD_URL?: string }
export type Waiter = { waitUntil: (promise: Promise<unknown>) => void }

export function isLive(url: URL): boolean {
  return LIVE_HOSTS.has(url.hostname)
}

// An install's batch passes through as it is; a browser's (no instance) keeps only BROWSER_EVENTS.
export async function ingest({ request, env, ctx }: { request: Request; env: HubEnv; ctx: Waiter }): Promise<Response> {
  const text = await request.text()
  if (text.length > MAX_BODY) return failure(413, 'That batch is too large. Send at most 100 events at a time.')
  const batch = telemetryBatch(parse(text), { site: true })
  if (!batch) return failure(400, 'Send JSON with up to 100 events, and an instance UUID and a version if you are an install.')
  const events = batch.instance ? batch.events : batch.events.filter((event) => BROWSER_EVENTS.includes(event.name))
  if (isLive(new URL(request.url)) && events.length) ctx.waitUntil(save({ env, ...batch, events, country: countryOf(request) }))
  return new Response(null, { status: 202 })
}

export async function save({ env, ...batch }: TelemetryBatch & { env: HubEnv }): Promise<void> {
  if (!env.STATS_TOKEN) return
  try {
    const response = await fetch(`${env.CLOUD_URL ?? CLOUD}/v1/events`, { method: 'POST', headers: { authorization: `Bearer ${env.STATS_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(batch) })
    if (!response.ok) console.log(JSON.stringify({ event: 'stats.rejected', status: response.status }))
  } catch (error) {
    console.log(JSON.stringify({ event: 'stats.failed', error: error instanceof Error ? error.message : String(error) }))
  }
}

export function countryOf(request: Request): string | undefined {
  const cf = (request as Request & { cf?: { country?: unknown } }).cf
  return typeof cf?.country === 'string' ? cf.country : undefined
}

export function clientOf(userAgent: string): string {
  if (/^curl\//i.test(userAgent)) return 'curl'
  if (/^wget\//i.test(userAgent)) return 'wget'
  return 'other'
}

function parse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function failure(status: number, message: string): Response {
  return Response.json({ error: { type: 'invalid_request_error', message } }, { status })
}
