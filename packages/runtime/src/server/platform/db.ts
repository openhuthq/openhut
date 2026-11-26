import { mkdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Kysely, PGliteDialect, sql, type Selectable } from 'kysely'
import { config } from './config.ts'
import type { Database } from './db-schema.ts'
import { ChannelKind } from '@openhut/common/channels/channel.ts'
import { CallOutcome, ConnectionKind } from '@openhut/common/connections/connection.ts'
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
    id text primary key, email text unique not null, name text not null default '', pass text, role text not null check (role in ('owner', 'admin', 'member')),
    created_at timestamptz not null default now(), removed_at timestamptz)`.execute(db)
  await sql`create unique index if not exists one_owner on person (role) where role = 'owner'`.execute(db)
  await sql`create table if not exists session (hash text primary key, person_id text not null references person(id), expires_at timestamptz not null)`.execute(db)
  await sql`create table if not exists invite (
    hash text primary key, role text not null check (role in ('admin', 'member')), created_by text not null references person(id), expires_at timestamptz not null)`.execute(db)
  await sql`create table if not exists password_reset (hash text primary key, person_id text not null references person(id), expires_at timestamptz not null)`.execute(db)
  await sql`create table if not exists computer (
    id text primary key, name text not null, token_hash text unique not null, expires_at timestamptz, version text, gvisor boolean,
    update_error text, seen_at timestamptz, created_at timestamptz not null default now())`.execute(db)
  await sql`create table if not exists agent (
    id text primary key, name text not null, owner_id text not null references person(id), instructions text not null,
    model text not null default 'claude:sonnet', net integer unique not null check (net between 1 and 250),
    wanted text not null default 'stopped' check (wanted in ('running', 'stopped')),
    channel_key text not null, created_at timestamptz not null default now(),
    code_execution boolean not null default true, web_browser boolean not null default false, face text,
    size text not null default 'standard' check (size in ('standard', 'large', 'xlarge')), token_epoch integer not null default 0,
    fallback_model text, helper_models text not null default '{}', runs_on text, changed_by text, workspace text,
    shared boolean not null default false, owner text, people text not null default '[]')`.execute(db)
  await sql`create table if not exists channel (
    id text primary key, agent_id text not null references agent(id) on delete cascade,
    kind text not null check (kind in (${sql.join(ChannelKind.options.map((kind) => sql.lit(kind)))})),
    status text not null check (status in ('connected', 'linking')), account text, owner_address text not null, secrets text not null default '',
    open boolean not null default false, allowed text not null default '', created_at timestamptz not null default now(), unique (agent_id, kind))`.execute(db)
  await sql`create table if not exists connection (
    id text primary key, kind text not null check (kind in (${sql.join(ConnectionKind.options.map((kind) => sql.lit(kind)))})),
    name text not null, owner_id text not null references person(id), config text not null, everyone boolean not null default false,
    created_at timestamptz not null default now(), account text not null default '', sign_in boolean not null default false, changed_by text)`.execute(db)
  await sql`create table if not exists connection_grant (
    id text primary key, connection_id text not null references connection(id) on delete cascade, agent_id text not null references agent(id) on delete cascade,
    created_at timestamptz not null default now(), unique (connection_id, agent_id))`.execute(db)
  await sql`create table if not exists connection_event (
    id bigserial primary key, at timestamptz not null default now(), agent_id text not null, connection_id text, tool text not null,
    reason text not null, outcome text not null check (outcome in ('allowed', 'asked', 'denied', 'failed')), ms integer not null, approved_by text)`.execute(db)
  await sql`create index if not exists connection_event_by_connection on connection_event (connection_id, id desc)`.execute(db)
  await sql`create index if not exists connection_event_by_agent on connection_event (agent_id, id desc)`.execute(db)
  await sql`create table if not exists tool_permission (
    agent_id text not null references agent(id) on delete cascade, connection_id text not null references connection(id) on delete cascade, tool text not null,
    state text not null check (state in ('allow', 'ask', 'deny')), changed_by text not null, changed_at timestamptz not null default now(),
    primary key (agent_id, connection_id, tool))`.execute(db)
  await sql`create table if not exists routine (
    id text primary key, agent_id text not null references agent(id) on delete cascade, name text not null, plan text not null,
    at timestamptz, cron text, until timestamptz, origin text not null, next_run_at timestamptz, created_at timestamptz not null default now(),
    run_id text, run_status text check (run_status in ('open', 'told', 'quiet', 'failed')), run_picked_at timestamptz, run_at timestamptz, run_text text,
    failures integer not null default 0)`.execute(db)
  await sql`create index if not exists routine_due on routine (next_run_at) where next_run_at is not null`.execute(db)
  await sql`create table if not exists record (
    key text primary key, collection text not null, id text not null, workspace text not null, parent text, ver integer not null,
    value text not null, secret text, personal boolean not null default false, deleted boolean not null default false)`.execute(db)
  await sql`create index if not exists record_by_parent on record (collection, workspace, parent)`.execute(db)
  await sql`create table if not exists change_request (
    id text primary key, agent_id text not null references agent(id) on delete cascade, action text not null, input text not null, summary text not null,
    why text not null, origin text not null, status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired')), note text,
    told boolean not null default false, created_at timestamptz not null default now(), decided_at timestamptz, expires_at timestamptz, result text)`.execute(db)
  await sql`create index if not exists change_request_by_agent on change_request (agent_id, created_at desc)`.execute(db)
  await sql`create table if not exists telegram_code (
    hash text primary key, channel_id text not null, agent_id text not null, kind text not null check (kind in ('claim', 'invite')),
    sealed text, expires_at timestamptz not null)`.execute(db)
  await upgrade()
}

async function upgrade(): Promise<void> {
  await sql`alter table connection_event add column if not exists approved_by text`.execute(db)
  await sql`alter table change_request add column if not exists expires_at timestamptz, add column if not exists result text`.execute(db)
  await allowOnly({ table: 'connection_event', column: 'outcome', values: CallOutcome.options })
  await allowOnly({ table: 'change_request', column: 'status', values: ['pending', 'approved', 'denied', 'expired'] })
  await allowOnly({ table: 'channel', column: 'kind', values: ChannelKind.options })
  await allowOnly({ table: 'connection', column: 'kind', values: ConnectionKind.options })
}

async function allowOnly({ table, column, values }: { table: string; column: string; values: readonly string[] }): Promise<void> {
  const name = `${table}_${column}_check`
  const { rows } = await sql<{ def: string }>`select pg_get_constraintdef(oid) as def from pg_constraint where conname = ${name}`.execute(db)
  const current = new Set([...(rows[0]?.def ?? '').matchAll(/'([^']*)'/g)].map((match) => match[1]))
  if (current.size === values.length && values.every((value) => current.has(value))) return
  await sql`alter table ${sql.table(table)} drop constraint if exists ${sql.id(name)}, add constraint ${sql.id(name)} check (${sql.ref(column)} in (${sql.join(values.map((value) => sql.lit(value)))}))`.execute(db)
}
