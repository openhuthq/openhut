import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import pg from 'pg'
import * as z from 'zod/mini'
import { publicAddress } from '../../platform/address.ts'
import { config as runtimeConfig } from '../../platform/config.ts'
import { HttpError, messageOf } from '../../platform/http-error.ts'
import { checkedAddress } from '../../platform/network.ts'
import { nativeConnector, nativeTool } from '../connector.ts'

const MAX_BYTES = 8 << 20
const ENCRYPTED = { rejectUnauthorized: false }
const SSL_MODES = {
  disable: [false],
  allow: [false, ENCRYPTED],
  prefer: [ENCRYPTED, false],
  require: [ENCRYPTED],
  'verify-ca': [{ rejectUnauthorized: true, checkServerIdentity: () => undefined }],
  'verify-full': [{ rejectUnauthorized: true }],
} as const

export const postgres = {
  parseDsn,
  probe,
  query: runQuery,
  explain: runExplain,
  connector: nativeConnector({
    config: z.object({ dsn: z.string() }),
    tools: {
      tables: nativeTool({
        description: 'List tables and their columns.',
        input: z.strictObject({}),
        run: ({ config }: { config: { dsn: string } }) => runQuery({ dsn: config.dsn, sql: 'select table_schema, table_name, string_agg(column_name, \', \' order by ordinal_position) as columns from information_schema.columns where table_schema not in (\'pg_catalog\', \'information_schema\') group by 1, 2 order by 1, 2' }),
      }),
      query: nativeTool({
        description: 'Run one read-only SELECT. 15 s timeout, at most 1000 rows.',
        input: z.strictObject({ sql: z.string().check(z.minLength(1, 'Pass the SELECT to run.')) }),
        run: ({ config, args }: { config: { dsn: string }; args: { sql: string } }) => runQuery({ dsn: config.dsn, sql: args.sql }),
      }),
      explain: nativeTool({
        description: 'Show the query plan for one statement, without running it: plain EXPLAIN in a read-only transaction, never ANALYZE. Pass the query without EXPLAIN. format json gives the plan as JSON.',
        input: z.strictObject({ sql: z.string().check(z.minLength(1, 'Pass the query to explain.')), format: z.optional(z.enum(['text', 'json'])) }),
        run: ({ config, args }: { config: { dsn: string }; args: { sql: string; format?: 'text' | 'json' } }) => runExplain({ dsn: config.dsn, sql: args.sql, format: args.format }),
      }),
    },
  }),
  account(dsn: string): string {
    const target = parseDsn(dsn)
    return `${target.host}/${target.database}`
  },
}

function parseDsn(dsn: string) {
  const url = URL.canParse(dsn) ? new URL(dsn) : undefined
  if (!url || !/^postgres(ql)?:$/.test(url.protocol) || !url.hostname) throw new HttpError(400, 'Paste a postgres:// connection string.', { param: 'dsn' })
  const extra = [...url.searchParams.keys()].filter((key) => key !== 'sslmode')
  if (extra.length) throw new HttpError(400, `Remove ${extra.join(', ')} from the connection string: only sslmode is allowed.`, { param: 'dsn' })
  const mode = url.searchParams.get('sslmode') ?? 'prefer'
  if (!isSslMode(mode)) throw new HttpError(400, `Set sslmode to one of ${Object.keys(SSL_MODES).join(', ')}.`, { param: 'dsn' })
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: Number(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)) || 'postgres',
    sslAttempts: SSL_MODES[mode],
  }
}

async function runQuery({ dsn, sql }: { dsn: string; sql: string }): Promise<{ rows: unknown[]; truncated: boolean }> {
  return readOnly({
    dsn,
    run: async (client) => {
      const cursor: pg.QueryConfig & { queryMode: 'extended' } = { text: `declare jb no scroll cursor for ${sql}`, queryMode: 'extended' }
      await client.query(cursor)
      const result = await client.query('fetch 1001 from jb')
      return { rows: result.rows.slice(0, 1000), truncated: result.rows.length > 1000 }
    },
  })
}

async function runExplain({ dsn, sql, format = 'text' }: { dsn: string; sql: string; format?: 'text' | 'json' }): Promise<{ plan: unknown }> {
  if (/^\s*explain\b/i.test(sql)) throw new Error('Pass the query itself, without EXPLAIN.')
  if (/\banaly[sz]e\b/i.test(sql)) throw new Error('Refused: ANALYZE runs the query. Only the plan is allowed.')
  return readOnly({
    dsn,
    run: async (client) => {
      const explain: pg.QueryConfig & { queryMode: 'extended' } = { text: `explain (format ${format}) ${sql}`, queryMode: 'extended' }
      const rows = (await client.query<{ 'QUERY PLAN': unknown }>(explain)).rows.map((row) => row['QUERY PLAN'])
      return { plan: format === 'json' ? rows[0] : rows.join('\n') }
    },
  })
}

async function readOnly<T>({ dsn, run }: { dsn: string; run: (client: pg.Client) => Promise<T> }): Promise<T> {
  const { sslAttempts, ...target } = parseDsn(dsn)
  const host = await checkedAddress(target.host)
  const client = await connectFirst({ attempts: sslAttempts.map((ssl) => ({ ...target, host, ssl: ssl && !isIP(target.host) ? { ...ssl, servername: target.host } : ssl })) })
  const stream = client.connection.stream
  let bytes = 0
  let tooBig = false
  stream.on('data', (chunk: Buffer) => {
    bytes += chunk.length
    if (bytes > MAX_BYTES && !tooBig) {
      tooBig = true
      stream.destroy()
    }
  })
  try {
    const risky = await client.query<{ risky: boolean }>(`select exists (select 1 from pg_roles r where r.rolsuper and pg_has_role(current_user, r.oid, 'member'))
      or pg_has_role(current_user, 'pg_execute_server_program', 'member') or pg_has_role(current_user, 'pg_write_server_files', 'member')
      or pg_has_role(current_user, 'pg_read_server_files', 'member') as risky`)
    if (risky.rows[0]?.risky) throw new Error('Refused: this connection logs in as a superuser, a member of one, or a role that can run server programs or touch server files. Use a read-only role.')
    await client.query('begin read only')
    await client.query('set local statement_timeout = 15000')
    return await run(client)
  } catch (err) {
    if (tooBig) throw new Error('Result too large: over 8 MB. Select fewer or narrower columns.')
    throw err
  } finally {
    await client.query('rollback').catch(() => undefined)
    await client.end().catch(() => undefined)
  }
}

async function connectFirst({ attempts }: { attempts: pg.ClientConfig[] }): Promise<pg.Client> {
  let lastError: unknown
  for (const attempt of attempts) {
    const client = new pg.Client({ ...attempt, query_timeout: 20_000, connectionTimeoutMillis: 5_000 })
    client.on('error', () => undefined)
    try {
      await client.connect()
      return client
    } catch (err) {
      lastError = err
      await client.end().catch(() => undefined)
    }
  }
  throw lastError
}

const WRITABLE = `select exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and n.nspname not like 'pg\\_%' and n.nspname <> 'information_schema'
  and has_table_privilege(c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')) as writable`

async function probe(dsn: string): Promise<string> {
  const account = postgres.account(dsn)
  const writable = await readOnly({ dsn, run: async (client) => (await client.query<{ writable: boolean }>(WRITABLE)).rows[0]?.writable })
    .catch(async (err: unknown) => { throw new HttpError(400, await testFailure({ dsn, err }), { param: 'dsn' }) })
  return writable ? `${account} · can write` : account
}

async function testFailure({ dsn, err }: { dsn: string; err: unknown }): Promise<string> {
  const { host, port, user } = parseDsn(dsn)
  const code = (err as { code?: unknown } | undefined)?.code
  const message = messageOf(err)
  if (message.startsWith('Refused')) return message
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `No database answers at ${host}. Check the host name.`
  if (/\bSSL\b/i.test(message) && typeof code !== 'string') return `${message}. Set sslmode in the connection string to what the database supports.`
  if (code === '28P01' || code === '28000' || /authentication failed|password/i.test(message)) return `The database turned down ${user || 'this user'}: ${message}. Check the user name and password.`
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return `The test query failed: ${message}. Check the connection string.`
  const ip = await outboundIp()
  return `Couldn't reach ${host}:${port}: ${message}. Add this computer${ip ? ` (${ip})` : ''} to the database's trusted sources or firewall, then check the host and port.`
}

async function outboundIp(): Promise<string | undefined> {
  const address = publicAddress()
  if (runtimeConfig.behindProxy || address.startsWith('http://127.0.0.1')) return undefined
  return (await lookup(new URL(address).hostname, { family: 4 }).catch(() => undefined))?.address
}

const isSslMode = (mode: string): mode is keyof typeof SSL_MODES => mode in SSL_MODES
