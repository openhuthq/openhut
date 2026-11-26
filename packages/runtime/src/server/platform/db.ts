import { mkdirSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { Kysely, PGliteDialect, sql, type Selectable } from 'kysely'
import { config } from './config.ts'
import type { Database } from './db-schema.ts'
import { HttpError } from './http-error.ts'

const ID = /^[a-z]+_[a-z0-9]{8}$/

mkdirSync(config.dataDir, { recursive: true, mode: 0o700 })

export const pglite = await PGlite.create(`${config.dataDir}/pglite`)
export const db = new Kysely<Database>({ dialect: new PGliteDialect({ pglite }) })

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
  await sql`create table if not exists record (
    key text primary key, collection text not null, id text not null, workspace text not null, parent text, ver integer not null,
    value text not null, secret text, personal boolean not null default false, deleted boolean not null default false)`.execute(db)
  await sql`create index if not exists record_by_parent on record (collection, workspace, parent)`.execute(db)
  const { plugins } = await import('../../core/plugins.ts')
  for (const plugin of plugins()) await plugin.migrate?.(db)
}

export async function allowOnly({ table, column, values }: { table: string; column: string; values: readonly string[] }): Promise<void> {
  const name = `${table}_${column}_check`
  const { rows } = await sql<{ def: string }>`select pg_get_constraintdef(oid) as def from pg_constraint where conname = ${name}`.execute(db)
  const current = new Set([...(rows[0]?.def ?? '').matchAll(/'([^']*)'/g)].map((match) => match[1]))
  if (current.size === values.length && values.every((value) => current.has(value))) return
  await sql`alter table ${sql.table(table)} drop constraint if exists ${sql.id(name)}, add constraint ${sql.id(name)} check (${sql.ref(column)} in (${sql.join(values.map((value) => sql.lit(value)))}))`.execute(db)
}
