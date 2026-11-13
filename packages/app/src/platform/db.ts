import { mkdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Kysely, PGliteDialect, sql, type Selectable } from 'kysely'
import { config } from './config.ts'
import type { Database } from './db-schema.ts'
import { HttpError } from './http-error.ts'

const ID = /^[a-z]+_[a-z0-9]{8}$/

mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })

export const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: await PGlite.create(`${config.dataDir}/pglite`) }) })

await sql`create table if not exists install_setting (name text primary key, value text not null)`.execute(db)

export async function findRow<T extends 'agent' | 'channel' | 'connection_grant'>({ table, id, missing }: { table: T; id: string; missing: string }): Promise<Selectable<Database[T]>> {
  const [row] = ID.test(id) ? (await sql<Selectable<Database[T]>>`select * from ${sql.table(table)} where id = ${id}`.execute(db)).rows : []
  if (!row) throw new HttpError(404, missing)
  return row
}

export const isUniqueViolation = (err: unknown): boolean => typeof err === 'object' && err !== null && 'code' in err && err.code === '23505'

export async function migrate(): Promise<void> {
  await sql`create table if not exists person (
    id text primary key, email text unique not null, pass text not null, role text not null check (role in ('owner', 'admin', 'member')),
    created_at timestamptz not null default now(), removed_at timestamptz)`.execute(db)
  await sql`do $$ begin if exists (select from information_schema.columns where table_name = 'person' and column_name = 'username') then alter table person rename column username to email; end if; end $$`.execute(db)
  await sql`create unique index if not exists one_owner on person (role) where role = 'owner'`.execute(db)
  await sql`create table if not exists session (hash text primary key, person_id text not null references person(id) on delete cascade, expires_at timestamptz not null)`.execute(db)
  await sql`create table if not exists invite (
    id text primary key, hash text unique not null, role text not null check (role in ('admin', 'member')),
    created_by text not null references person(id) on delete cascade, expires_at timestamptz not null, used_at timestamptz)`.execute(db)
  await sql`create table if not exists agent (
    id text primary key, name text not null, owner_id text not null references person(id), instructions text not null,
    model text not null default 'sonnet' check (model in ('opus', 'sonnet', 'haiku')), net integer unique not null check (net between 1 and 250),
    wanted text not null default 'stopped' check (wanted in ('running', 'stopped')),
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
