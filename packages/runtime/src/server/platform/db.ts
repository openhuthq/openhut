import { mkdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Kysely, PGliteDialect, sql, type Selectable } from 'kysely'
import { config } from './config.ts'
import type { Database } from './db-schema.ts'
import { ChannelKind } from '@openhut/common/channels/channel.ts'
import { ConnectionKind } from '@openhut/common/connections/connection.ts'
import { HttpError } from './http-error.ts'

const ID = /^[a-z]+_[a-z0-9]{8}$/

mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })

export const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite: await PGlite.create(`${config.dataDir}/pglite`) }) })

await sql`create table if not exists install_setting (name text primary key, value text not null)`.execute(db)

export async function findRow<T extends 'agent' | 'channel' | 'connection_grant' | 'thread'>({ table, id, missing }: { table: T; id: string; missing: string }): Promise<Selectable<Database[T]>> {
  const [row] = ID.test(id) ? (await sql<Selectable<Database[T]>>`select * from ${sql.table(table)} where id = ${id}`.execute(db)).rows : []
  if (!row) throw new HttpError(404, missing)
  return row
}

export const isUniqueViolation = (err: unknown): boolean => typeof err === 'object' && err !== null && 'code' in err && err.code === '23505'

export async function migrate(): Promise<void> {
  await sql`create table if not exists person (
    id text primary key, email text unique not null, role text not null check (role in ('owner', 'admin', 'member')),
    created_at timestamptz not null default now(), removed_at timestamptz)`.execute(db)
  await sql`do $$ begin if exists (select from information_schema.columns where table_name = 'person' and column_name = 'username') then alter table person rename column username to email; end if; end $$`.execute(db)
  await sql`create unique index if not exists one_owner on person (role) where role = 'owner'`.execute(db)
  await sql`alter table person drop column if exists pass`.execute(db)
  await sql`drop table if exists session, invite, oauth_code, oauth_grant, oauth_client`.execute(db)
  await sql`create table if not exists agent (
    id text primary key, name text not null, owner_id text not null references person(id), instructions text not null,
    model text not null default 'claude:sonnet', net integer unique not null check (net between 1 and 250),
    wanted text not null default 'stopped' check (wanted in ('running', 'stopped')),
    channel_key text not null, created_at timestamptz not null default now())`.execute(db)
  await sql`alter table agent add column if not exists code_execution boolean not null default true`.execute(db)
  await sql`alter table agent add column if not exists web_browser boolean not null default false`.execute(db)
  await sql`alter table agent add column if not exists face text`.execute(db)
  await sql`alter table agent add column if not exists size text not null default 'standard' check (size in ('standard', 'large', 'xlarge'))`.execute(db)
  await sql`alter table agent add column if not exists token_epoch integer not null default 0`.execute(db)
  await sql`alter table agent drop constraint if exists agent_model_check`.execute(db)
  await sql`alter table agent alter column model set default 'claude:sonnet'`.execute(db)
  await sql`update agent set model = 'claude:' || model where model in ('opus', 'sonnet', 'haiku')`.execute(db)
  await sql`update agent set model = 'codex:gpt-5.5' where model = 'codex'`.execute(db)
  await sql`alter table agent add column if not exists fallback_model text`.execute(db)
  await sql`alter table agent add column if not exists helper_models text not null default '{}'`.execute(db)
  await sql`create table if not exists channel (
    id text primary key, agent_id text not null references agent(id) on delete cascade, kind text not null check (kind in ('slack', 'whatsapp')),
    status text not null check (status in ('connected', 'linking')), account text, owner_address text not null, secrets text not null default '',
    open boolean not null default false, allowed text not null default '', created_at timestamptz not null default now(), unique (agent_id, kind))`.execute(db)
  await sql`alter table channel drop constraint if exists channel_kind_check`.execute(db)
  await sql`alter table channel add constraint channel_kind_check check (kind in (${sql.join(ChannelKind.options.map((kind) => sql.lit(kind)))}))`.execute(db)
  await sql`update channel set owner_address = '', open = false, allowed = '' where kind = 'slack' and owner_address <> ''`.execute(db)
  await sql`create table if not exists connection (
    id text primary key, kind text not null, name text not null, owner_id text not null references person(id),
    config text not null, everyone boolean not null default false, created_at timestamptz not null default now())`.execute(db)
  await sql`alter table connection add column if not exists account text not null default ''`.execute(db)
  await sql`alter table connection add column if not exists sign_in boolean not null default false`.execute(db)
  await sql`alter table connection drop constraint if exists connection_kind_check`.execute(db)
  await sql`alter table connection add constraint connection_kind_check check (kind in (${sql.join(ConnectionKind.options.map((kind) => sql.lit(kind)))}))`.execute(db)
  await sql`create table if not exists connection_grant (
    id text primary key, connection_id text not null references connection(id) on delete cascade, agent_id text not null references agent(id) on delete cascade,
    created_at timestamptz not null default now(), unique (connection_id, agent_id))`.execute(db)
  await sql`create table if not exists connection_event (
    id bigserial primary key, at timestamptz not null default now(), agent_id text not null, connection_id text, tool text not null,
    reason text not null, outcome text not null check (outcome in ('allowed', 'denied', 'failed')), ms integer not null)`.execute(db)
  await sql`create index if not exists connection_event_by_connection on connection_event (connection_id, id desc)`.execute(db)
  await sql`create index if not exists connection_event_by_agent on connection_event (agent_id, id desc)`.execute(db)
  await sql`create table if not exists thread (
    id text primary key, agent_id text not null references agent(id) on delete cascade, person_id text not null references person(id) on delete cascade,
    title text not null, messages text not null default '[]', created_at timestamptz not null default now(), updated_at timestamptz not null default now())`.execute(db)
  await sql`create index if not exists thread_by_person on thread (person_id, updated_at desc)`.execute(db)
  await sql`create table if not exists routine (
    id text primary key, agent_id text not null references agent(id) on delete cascade, name text not null, plan text not null,
    at timestamptz, cron text, until timestamptz, origin text not null, next_run_at timestamptz, created_at timestamptz not null default now(),
    run_id text, run_status text check (run_status in ('open', 'told', 'quiet', 'failed')), run_picked_at timestamptz, run_at timestamptz, run_text text,
    failures integer not null default 0)`.execute(db)
  await sql`create index if not exists routine_due on routine (next_run_at) where next_run_at is not null`.execute(db)
  await sql`update agent set owner_id = o.id from person o where o.role = 'owner' and owner_id <> o.id`.execute(db)
  await sql`update connection set owner_id = o.id from person o where o.role = 'owner' and owner_id <> o.id`.execute(db)
  await sql`update thread set person_id = o.id from person o where o.role = 'owner' and person_id <> o.id`.execute(db)
  await sql`create table if not exists cloud_record (id text primary key, kind text not null, ref text not null, ver integer not null, hash text not null)`.execute(db)
}
