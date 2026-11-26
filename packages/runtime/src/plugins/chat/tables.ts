import { sql, type Kysely } from 'kysely'
import type { Database } from '../../server/platform/db-schema.ts'

export async function createTables(db: Kysely<Database>): Promise<void> {
  await sql`create table if not exists chat_thread (
    id text primary key, agent_id text not null references agent(id) on delete cascade, key text, title text not null,
    origin text not null, mirrors text not null default '[]', mirror_paused boolean not null default false, continue_url text, web_streak integer not null default 0, created_at timestamptz not null default now(), unique (agent_id, key))`.execute(db)
  await sql`alter table agent add column if not exists notify text`.execute(db)
  await sql`alter table chat_thread add column if not exists archived_at timestamptz`.execute(db)
}
