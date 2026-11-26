import { sql, type Kysely } from 'kysely'
import type { Database } from '../../server/platform/db-schema.ts'

export async function createTables(db: Kysely<Database>): Promise<void> {
  await sql`create table if not exists inbox_source (
    id text primary key, agent_id text not null references agent(id) on delete cascade, kind text not null check (kind in ('schedule', 'webhook')), name text not null,
    origin text not null, created_at timestamptz not null default now(), plan text not null default '', at timestamptz, cron text, until timestamptz, next_run_at timestamptz,
    run_id text, run_status text check (run_status in ('open', 'told', 'quiet', 'failed')), run_picked_at timestamptz, run_at timestamptz, run_text text,
    failures integer not null default 0, secret text, last_at timestamptz)`.execute(db)
  await sql`create index if not exists inbox_source_due on inbox_source (next_run_at) where next_run_at is not null`.execute(db)
  await sql`create table if not exists inbox_item (
    id text primary key, source_id text not null references inbox_source(id) on delete cascade, agent_id text not null, digest text not null, text text not null,
    told boolean not null default false, created_at timestamptz not null default now(), unique (source_id, digest))`.execute(db)
  await sql`alter table inbox_source add column if not exists threads text not null default 'group' check (threads in ('group', 'each'))`.execute(db)
  await sql`alter table inbox_source add column if not exists group_by text`.execute(db)
  await sql`alter table inbox_source add column if not exists title_by text`.execute(db)
  await sql`alter table inbox_source add column if not exists label_by text`.execute(db)
  await sql`alter table inbox_item add column if not exists group_key text`.execute(db)
  await sql`create table if not exists inbox_thread (source_id text not null references inbox_source(id) on delete cascade, group_key text not null, thread_id text not null, primary key (source_id, group_key))`.execute(db)
  const { rows } = await sql<{ found: string | null }>`select to_regclass('routine')::text as found`.execute(db)
  if (rows[0]?.found) await sql`insert into inbox_source (id, agent_id, kind, name, origin, created_at, plan, at, cron, until, next_run_at, run_id, run_status, run_picked_at, run_at, run_text, failures)
    select id, agent_id, 'schedule', name, origin, created_at, plan, at, cron, until, next_run_at, run_id, run_status, run_picked_at, run_at, run_text, failures from routine
    on conflict (id) do nothing`.execute(db)
}
