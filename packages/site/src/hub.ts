import { telemetryBatch, type TelemetryEvent } from '@openhut/common/telemetry.ts'

export const DATABUDDY_CLIENT_ID = '40a6e1dc-4e64-4fd6-8b92-415a77397465'
const BASKET = 'https://basket.databuddy.cc/track'
const LIVE_HOSTS = new Set(['openhut.dev', 'www.openhut.dev'])
const MAX_BODY = 64_000

export type HubEnv = { DATABUDDY_API_KEY?: string }
export type Waiter = { waitUntil: (promise: Promise<unknown>) => void }

export function isLive(url: URL): boolean {
  return LIVE_HOSTS.has(url.hostname)
}

export async function forward({ env, events, instance, version }: { env: HubEnv; events: TelemetryEvent[]; instance?: string; version?: string }): Promise<void> {
  for (const event of events) console.log(JSON.stringify({ event: 'telemetry', name: event.name, instance: instance ?? null, version: version ?? null, properties: event.properties }))
  const key = env.DATABUDDY_API_KEY
  if (!key) return
  await Promise.all(events.map(async (event) => {
    const body = {
      name: event.name, websiteId: DATABUDDY_CLIENT_ID, anonymousId: instance, timestamp: event.at, source: 'server', namespace: instance ? 'self-hosted' : 'site',
      properties: version ? { ...event.properties, version } : event.properties,
    }
    try {
      const response = await fetch(BASKET, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!response.ok) console.log(JSON.stringify({ event: 'telemetry.rejected', name: event.name, status: response.status }))
    } catch (error) {
      console.log(JSON.stringify({ event: 'telemetry.failed', name: event.name, error: error instanceof Error ? error.message : String(error) }))
    }
  }))
}

export async function ingest({ request, env, ctx }: { request: Request; env: HubEnv; ctx: Waiter }): Promise<Response> {
  const text = await request.text()
  if (text.length > MAX_BODY) return failure(413, 'That batch is too large. Send at most 100 events at a time.')
  const batch = telemetryBatch(parse(text))
  if (!batch) return failure(400, 'Send JSON with an instance UUID, a version and up to 100 events.')
  if (isLive(new URL(request.url))) ctx.waitUntil(forward({ env, ...batch }))
  return new Response(null, { status: 202 })
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
