import { isIP } from 'node:net'
import pg from 'pg'
import * as z from 'zod/mini'
import { HttpError } from '../../platform/http-error.ts'
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
  query: runQuery,
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
    const cursor: pg.QueryConfig & { queryMode: 'extended' } = { text: `declare jb no scroll cursor for ${sql}`, queryMode: 'extended' }
    await client.query(cursor)
    const result = await client.query('fetch 1001 from jb')
    return { rows: result.rows.slice(0, 1000), truncated: result.rows.length > 1000 }
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
    const client = new pg.Client({ ...attempt, statement_timeout: 15_000, query_timeout: 20_000, connectionTimeoutMillis: 5_000 })
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

const isSslMode = (mode: string): mode is keyof typeof SSL_MODES => mode in SSL_MODES
