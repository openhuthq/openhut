import * as z from 'zod/mini'
import { HttpError, messageOf } from '../../platform/http-error.ts'
import { nativeConnector, nativeTool } from '../connector.ts'
import { clickhouse } from '../clickhouse/clickhouse.ts'

const API = 'https://telemetry.betterstack.com'
const MAX_ROWS = 1000
const SOURCE_PAGES = 4
const Time = z.string().check(z.minLength(1), z.maxLength(40))
const Limit = z.number().check(z.int(), z.minimum(1), z.maximum(MAX_ROWS))
const SourceId = z.number().check(z.int(), z.positive())
const SourceType = z.enum(['logs', 'spans', 'metrics', 'web_events', 'exceptions'])

type Config = { token: string }
type Source = { id: string | number; attributes: { name?: string; platform?: string; team_name?: string; data_region?: string; logs_retention?: number } }
type Query = { sourceId: number; sql: string; from?: string; to?: string; limit?: number; sourceType?: z.infer<typeof SourceType> }

export const betterstack = {
  probe,
  searchSql,
  queryBody,
  connector: nativeConnector({
    config: z.object({ token: z.string() }),
    tools: {
      sources: nativeTool({
        title: 'List sources',
        description: 'List the log sources: id, name and platform. Pass a source id to search or query.',
        input: z.strictObject({}),
        run: ({ config }: { config: Config }) => sources(config.token),
      }),
      search: nativeTool({
        title: 'Search logs',
        description: 'Find log lines in one source that contain some text (any case), newest first. from and to take ISO times, now-3h or Unix timestamps; the last hour by default. At most 1000 lines, 100 by default.',
        input: z.strictObject({ sourceId: SourceId, text: z.optional(z.string().check(z.maxLength(500))), from: z.optional(Time), to: z.optional(Time), limit: z.optional(Limit) }),
        run: ({ config, args }: { config: Config; args: { sourceId: number; text?: string; from?: string; to?: string; limit?: number } }) =>
          runQuery({ token: config.token, query: { sourceId: args.sourceId, sql: searchSql(args.text), from: args.from, to: args.to, limit: args.limit ?? 100, sourceType: 'logs' } }),
      }),
      query: nativeTool({
        title: 'Query logs',
        description: 'Run one read-only SQL query (ClickHouse) over a source. Write {{source}} for its table and {{start_time}} and {{end_time}} for the range; log rows have dt and raw (the JSON line). from and to take ISO times, now-3h or Unix timestamps; the last hour by default. At most 1000 rows.',
        input: z.strictObject({ sourceId: SourceId, sql: z.string().check(z.minLength(1, 'Pass the SELECT to run.'), z.maxLength(20_000)), from: z.optional(Time), to: z.optional(Time), limit: z.optional(Limit), sourceType: z.optional(SourceType) }),
        run: ({ config, args }: { config: Config; args: Query }) => runQuery({ token: config.token, query: args }),
      }),
    },
  }),
}

function searchSql(text: string | undefined): string {
  const match = text ? ` AND positionCaseInsensitive(raw, '${text.replace(/[\\']/g, '\\$&')}') > 0` : ''
  return `SELECT dt, raw FROM {{source}} WHERE dt BETWEEN {{start_time}} AND {{end_time}}${match} ORDER BY dt DESC`
}

function queryBody(query: Query): Record<string, unknown> {
  if (!clickhouse.readOnlySql(query.sql)) throw new Error('Refused: only SELECT and WITH queries run here.')
  return { source_id: query.sourceId, query: query.sql, start_time: query.from, end_time: query.to, limit: query.limit, source_type: query.sourceType }
}

async function runQuery({ token, query }: { token: string; query: Query }): Promise<{ rows: unknown[] }> {
  const answer = await call<{ data?: { attributes?: { rows?: unknown[] } } }>({ token, url: `${API}/api/v2/query`, body: queryBody(query) })
  return { rows: answer.data?.attributes?.rows ?? [] }
}

async function sources(token: string): Promise<{ sources: unknown[]; truncated: boolean }> {
  const found: Source[] = []
  let next: string | null | undefined = `${API}/api/v3/sources?per_page=250`
  for (let page = 0; next?.startsWith(`${API}/`) && page < SOURCE_PAGES; page += 1) {
    const answer: { data?: Source[]; pagination?: { next?: string | null } } = await call({ token, url: next })
    found.push(...answer.data ?? [])
    next = answer.pagination?.next
  }
  return {
    sources: found.map(({ id, attributes }) => ({ id: Number(id), name: attributes.name, platform: attributes.platform, team: attributes.team_name, region: attributes.data_region, retentionDays: attributes.logs_retention })),
    truncated: Boolean(next),
  }
}

async function call<T>({ token, url, body }: { token: string; url: string; body?: Record<string, unknown> }): Promise<T> {
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...body && { 'content-type': 'application/json' } },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(problem({ status: response.status, text }))
  return JSON.parse(text) as T
}

function problem({ status, text }: { status: number; text: string }): string {
  if (status === 401) return 'Invalid token: Better Stack turned it down. Reconnect with a new Telemetry API token.'
  if (status === 403) return 'This token can\'t read logs: its team role can\'t open Live tail.'
  if (status === 404) return 'No source with that id for this token. Call sources to see them.'
  const parsed = parsedJson(text)
  const detail = typeof parsed?.errors === 'string' ? parsed.errors : JSON.stringify(parsed?.errors ?? parsed?.error ?? text.slice(0, 500))
  return `Better Stack answered ${status}: ${detail}`
}

function parsedJson(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

async function probe(token: string): Promise<string> {
  if (!token || /\s/.test(token)) throw new HttpError(400, 'Paste the token as it is, with no spaces.', { param: 'token' })
  const answer = await call<{ data?: Source[] }>({ token, url: `${API}/api/v3/sources?per_page=1` }).catch((err: unknown) => {
    const message = messageOf(err)
    throw new HttpError(400, message.startsWith('Invalid token') ? 'Better Stack turned down that token. Copy a Telemetry API token again and paste it.' : `Couldn't check the token with Better Stack: ${message}. Try again.`, { param: 'token' })
  })
  return answer.data?.[0]?.attributes.team_name ?? 'Better Stack'
}
