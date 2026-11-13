import { createHash } from 'node:crypto'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { Kysely, PostgresDialect, sql } from 'kysely'
import pg from 'pg'
import { config } from './config.ts'
import type { Database } from './db-schema.ts'

const socketDir = join(tmpdir(), `jakebox-pg-${createHash('sha256').update(resolve(config.dataDir)).digest('hex').slice(0, 12)}`)
mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })
mkdirSync(socketDir, { recursive: true, mode: 0o700 })
rmSync(join(socketDir, '.s.PGSQL.5432'), { force: true })

const pglite = await PGlite.create(`${config.dataDir}/pglite`)
const socketServer = new PGLiteSocketServer({ db: pglite, path: join(socketDir, '.s.PGSQL.5432') })
await socketServer.start()

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ host: socketDir, user: 'postgres', database: 'postgres', max: 1, idleTimeoutMillis: 0 }) }),
})

await sql`create table if not exists install_setting (name text primary key, value text not null, updated_at timestamptz not null default now())`.execute(db)

export async function closeDb(): Promise<void> {
  await db.destroy()
  await socketServer.stop()
  await pglite.close()
}

export async function migrate(): Promise<void> {
  await sql`create table if not exists person (
    id text primary key, username text unique not null, pass text not null, role text not null check (role in ('owner', 'admin', 'member')),
    created_at timestamptz not null default now(), removed_at timestamptz)`.execute(db)
  await sql`create unique index if not exists one_owner on person (role) where role = 'owner'`.execute(db)
  await sql`create table if not exists session (hash text primary key, person_id text not null references person(id) on delete cascade, expires_at timestamptz not null)`.execute(db)
  await sql`create table if not exists invite (
    id text primary key, hash text unique not null, role text not null check (role in ('admin', 'member')),
    created_by text not null references person(id) on delete cascade, expires_at timestamptz not null, used_at timestamptz)`.execute(db)
  await sql`create table if not exists agent (
    id text primary key, name text not null, owner_id text not null references person(id), instructions text not null,
    model text not null default 'sonnet' check (model in ('opus', 'sonnet', 'haiku')), net integer unique not null check (net between 1 and 250),
    token_version integer not null default 1, wanted text not null default 'stopped' check (wanted in ('running', 'stopped')),
    channel_key text not null, created_at timestamptz not null default now())`.execute(db)
  await sql`create table if not exists channel (
    id text primary key, agent_id text not null references agent(id) on delete cascade, kind text not null check (kind in ('slack', 'whatsapp')),
    status text not null check (status in ('connected', 'linking')), account text, owner_address text not null, secrets text not null default '',
    open boolean not null default false, allowed text not null default '', created_at timestamptz not null default now(), unique (agent_id, kind))`.execute(db)
  await sql`create table if not exists connection (
    id text primary key, kind text not null check (kind in ('postgres')), name text not null, owner_id text not null references person(id),
    config text not null, everyone boolean not null default false, created_at timestamptz not null default now())`.execute(db)
  await sql`create table if not exists connection_grant (
    id text primary key, connection_id text not null references connection(id) on delete cascade, agent_id text not null references agent(id) on delete cascade,
    created_at timestamptz not null default now(), unique (connection_id, agent_id))`.execute(db)
  await sql`create table if not exists oauth_client (id text primary key, name text not null, redirect_uris text not null, created_at timestamptz not null default now())`.execute(db)
  await sql`create table if not exists oauth_code (code_hash text primary key, client_id text not null, person_id text not null references person(id) on delete cascade,
    redirect_uri text not null, challenge text not null, expires_at timestamptz not null)`.execute(db)
  await sql`create table if not exists oauth_grant (
    id text primary key, client_id text not null, person_id text not null references person(id) on delete cascade, access_hash text not null unique, refresh_hash text not null unique,
    access_expires_at timestamptz not null, created_at timestamptz not null default now(), used_at timestamptz)`.execute(db)
  await sql`create table if not exists connection_event (
    id bigserial primary key, at timestamptz not null default now(), agent_id text not null, connection_id text, tool text not null,
    reason text not null, outcome text not null check (outcome in ('allowed', 'denied', 'failed')), ms integer not null)`.execute(db)
  await sql`create index if not exists connection_event_by_connection on connection_event (connection_id, id desc)`.execute(db)
  await sql`create index if not exists connection_event_by_agent on connection_event (agent_id, id desc)`.execute(db)
}
