import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { Kysely, PostgresDialect, sql, type ColumnType, type Generated } from 'kysely'
import pg from 'pg'
import { config } from './config.ts'

const socketDir = join(tmpdir(), `jakebox-console-pg-${createHash('sha256').update(resolve(config.dataDir)).digest('hex').slice(0, 12)}`)
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
mkdirSync(socketDir, { recursive: true, mode: 0o700 })
rmSync(join(socketDir, '.s.PGSQL.5432'), { force: true })

const pglite = await PGlite.create(`${config.dataDir}/pglite`)
const socketServer = new PGLiteSocketServer({ db: pglite, path: join(socketDir, '.s.PGSQL.5432') })
await socketServer.start()

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ host: socketDir, user: 'postgres', database: 'postgres', max: 1, idleTimeoutMillis: 0 }) }),
})

export async function migrate(): Promise<void> {
  await sql`create table if not exists release (
    id text primary key, seq serial unique, build text unique not null, version text not null, sha256 text not null,
    url text not null, notes text not null default '', created_at timestamptz not null default now())`.execute(db)
  await sql`create table if not exists install (
    id text primary key, seq serial unique, build text not null, version text not null,
    last_check_in_at timestamptz not null default now(), created_at timestamptz not null default now())`.execute(db)
}

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>

export type Database = {
  release: { id: string; seq: Generated<number>; build: string; version: string; sha256: string; url: string; notes: string; created_at: Timestamp }
  install: { id: string; seq: Generated<number>; build: string; version: string; last_check_in_at: Timestamp; created_at: Timestamp }
}
