import * as z from 'zod/mini'
import { HttpError, messageOf } from '../../platform/http-error.ts'
import { guardedFetch } from '../../platform/network.ts'
import { nativeConnector, nativeTool } from '../connector.ts'

const MAX_ROWS = 1000
const MAX_BYTES = 8 << 20
const TIMEOUT_S = 15
const READS = /^(select|with|show|describe|desc|explain|exists)\b/i
const DATABASE = `if({database:String} = '', currentDatabase(), {database:String})`

type Config = { dsn: string }
type Rows = { rows: unknown[]; truncated: boolean }

export const clickhouse = {
  parseDsn,
  readOnlySql,
  query: runQuery,
  probe,
  connector: nativeConnector({
    config: z.object({ dsn: z.string() }),
    tools: {
      databases: nativeTool({
        title: 'List databases',
        description: 'List the databases this user can read.',
        input: z.strictObject({}),
        run: ({ config }: { config: Config }) => runQuery({ dsn: config.dsn, sql: 'select name from system.databases order by name' }),
      }),
      tables: nativeTool({
        title: 'List tables',
        description: 'List the tables in one database with their engine and row count. Leave database out for the connection\'s own.',
        input: z.strictObject({ database: z.optional(z.string().check(z.maxLength(200))) }),
        run: ({ config, args }: { config: Config; args: { database?: string } }) => runQuery({
          dsn: config.dsn,
          sql: `select name, engine, total_rows from system.tables where database = ${DATABASE} order by name`,
          params: { database: args.database ?? '' },
        }),
      }),
      describe: nativeTool({
        title: 'Describe tables',
        description: 'Show one table\'s columns: name, type, default and comment.',
        input: z.strictObject({ table: z.string().check(z.minLength(1, 'Pass the table name.'), z.maxLength(200)), database: z.optional(z.string().check(z.maxLength(200))) }),
        run: async ({ config, args }: { config: Config; args: { table: string; database?: string } }) => {
          const columns = await runQuery({
            dsn: config.dsn,
            sql: `select name, type, default_kind, default_expression, comment from system.columns where database = ${DATABASE} and table = {table:String} order by position`,
            params: { database: args.database ?? '', table: args.table },
          })
          if (!columns.rows.length) throw new Error(`No table named ${args.table}. Call tables to see them.`)
          return columns
        },
      }),
      query: nativeTool({
        title: 'Query data',
        description: `Run one read-only SELECT. ${TIMEOUT_S} s timeout, at most ${MAX_ROWS} rows.`,
        input: z.strictObject({ sql: z.string().check(z.minLength(1, 'Pass the SELECT to run.')) }),
        run: ({ config, args }: { config: Config; args: { sql: string } }) => runQuery({ dsn: config.dsn, sql: args.sql }),
      }),
    },
  }),
}

function parseDsn(dsn: string) {
  const url = URL.canParse(dsn) ? new URL(dsn) : undefined
  if (!url || !/^https?:$/.test(url.protocol) || !url.hostname) throw new HttpError(400, 'Paste an https:// address, like https://reader:…@abc.clickhouse.cloud:8443/default.', { param: 'dsn' })
  if (url.search || url.hash) throw new HttpError(400, 'Remove the part after ? from the address. OpenHut sets the query settings itself.', { param: 'dsn' })
  const authority = dsn.replace(/^[a-z]+:\/\//i, '').split('/')[0].split('@').pop() ?? ''
  const explicit = /:(\d+)$/.exec(authority)?.[1]
  const port = Number(url.port || explicit || (url.protocol === 'https:' ? 8443 : 8123))
  return {
    origin: `${url.protocol}//${url.hostname.includes(':') ? `[${url.hostname.replace(/^\[|\]$/g, '')}]` : url.hostname}:${port}`,
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port,
    user: decodeURIComponent(url.username) || 'default',
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
  }
}

function readOnlySql(sql: string): boolean {
  const start = sql.replace(/^(\s+|--[^\n]*(\n|$)|\/\*[\s\S]*?\*\/|\()*/, '')
  return READS.test(start)
}

async function runQuery({ dsn, sql, params = {} }: { dsn: string; sql: string; params?: Record<string, string> }): Promise<Rows> {
  if (!readOnlySql(sql)) throw new Error('Refused: only SELECT, WITH, SHOW, DESCRIBE, EXPLAIN and EXISTS run here.')
  const target = parseDsn(dsn)
  const fixed = { default_format: 'JSONEachRow', ...Object.fromEntries(Object.entries(params).map(([key, value]) => [`param_${key}`, value])), readonly: '1' }
  const limits = { max_execution_time: String(TIMEOUT_S), max_result_rows: String(MAX_ROWS + 1), result_overflow_mode: 'break', cancel_http_readonly_queries_on_client_close: '1' }
  const send = async (settings: Record<string, string>) => {
    const url = new URL(target.origin)
    url.search = new URLSearchParams(settings).toString()
    const response = await guardedFetch(url, {
      method: 'POST',
      headers: { 'x-clickhouse-user': target.user, 'x-clickhouse-key': target.password, ...target.database && { 'x-clickhouse-database': target.database } },
      body: sql,
      signal: AbortSignal.timeout((TIMEOUT_S + 5) * 1000),
    }).catch((err: unknown) => { throw err instanceof Error && err.cause instanceof Error ? err.cause : err })
    return { ok: response.ok, status: response.status, body: await capped(response) }
  }
  const first = await send({ ...limits, ...fixed })
  const answer = !first.ok && /Cannot modify '\w+' setting in readonly mode/.test(first.body) ? await send(fixed) : first
  if (!answer.ok) throw new Error(cleaned(answer.body) || `ClickHouse answered ${answer.status}.`)
  const rows = answer.body.split('\n').filter(Boolean).map(parsedLine)
  return { rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS }
}

async function capped(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let bytes = 0
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    bytes += read.value.length
    if (bytes > MAX_BYTES) {
      await reader.cancel()
      throw new Error('Result too large: over 8 MB. Select fewer or narrower columns.')
    }
    chunks.push(read.value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function parsedLine(line: string): unknown {
  try { return JSON.parse(line) } catch { return line }
}

function cleaned(body: string): string {
  const exception = (parsedLine(body.trim()) as { exception?: unknown } | undefined)?.exception
  return (typeof exception === 'string' ? exception : body).replace(/^Code: \d+\. /, '').replace(/DB::Exception: /g, '').replace(/\s*\(version .*\)\s*$/, '').trim().slice(0, 1000)
}

async function probe(dsn: string): Promise<string> {
  const { host, port, user, database } = parseDsn(dsn)
  await runQuery({ dsn, sql: 'select 1' }).catch((err: unknown) => {
    throw new HttpError(400, testFailure({ host, port, user, err }), { param: 'dsn' })
  })
  return `${host}/${database || 'default'}`
}

function testFailure({ host, port, user, err }: { host: string; port: number; user: string; err: unknown }): string {
  const code = (err as { code?: unknown } | undefined)?.code
  const message = messageOf(err)
  if (message.startsWith('Refused')) return message
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `No ClickHouse answers at ${host}. Check the host name.`
  if (/AUTHENTICATION_FAILED|REQUIRED_PASSWORD/.test(message)) return `ClickHouse turned down ${user}. Check the user name and password.`
  if (/UNKNOWN_DATABASE/.test(message)) return `${message}. Check the database name.`
  if (typeof code === 'string' || (err instanceof Error && err.name === 'TimeoutError')) return `Couldn't reach ${host}:${port}: ${message}. Check the address and port, and that this computer can reach it.`
  return `The test query failed: ${message}. Check the address.`
}
