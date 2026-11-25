import { BROWSER_EVENTS, telemetryBatch } from '@openhut/common/telemetry.ts'

// Events land in the Workers Analytics Engine dataset bound as EVENTS (wrangler.jsonc): one data point per event,
// index = install id ('browser' for openhut.dev's anonymous link clicks), blobs = name, version, kind, then the event's
// allow-listed string properties, doubles = its number properties (instance_active: agent count).
// ponytail: no per-IP rate limit; Analytics Engine samples under heavy load. Add a rate-limit binding if abuse shows up.
const MAX_BODY = 64_000

export type AnalyticsEngine = { writeDataPoint: (point: { indexes: string[]; blobs: string[]; doubles: number[] }) => void }
export type HubEnv = { EVENTS?: AnalyticsEngine }

// An install's batch is kept as it is; a browser's (no instance) keeps only BROWSER_EVENTS. telemetryBatch drops unknown events and properties.
export async function ingest({ request, env }: { request: Request; env: HubEnv }): Promise<Response> {
  const text = await request.text()
  if (text.length > MAX_BODY) return failure(413, 'That batch is too large. Send at most 100 events at a time.')
  const batch = telemetryBatch(parse(text), { site: true })
  if (!batch) return failure(400, 'Send JSON with up to 100 events, and an instance UUID and a version if you are an install.')
  const events = batch.instance ? batch.events : batch.events.filter((event) => BROWSER_EVENTS.includes(event.name))
  for (const event of events) {
    const values = Object.values(event.properties)
    env.EVENTS?.writeDataPoint({
      indexes: [batch.instance ?? 'browser'],
      blobs: [event.name, batch.version ?? '', batch.kind ?? '', ...values.filter((value) => typeof value === 'string')],
      doubles: values.filter((value) => typeof value === 'number'),
    })
  }
  return new Response(null, { status: 202 })
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
