import { sql, type Kysely } from 'kysely'
import type { Database } from '../../server/platform/db-schema.ts'

export async function createTables(db: Kysely<Database>): Promise<void> {
  await sql`create table if not exists chat_thread (
    id text primary key, agent_id text not null references agent(id) on delete cascade, key text, title text not null,
    origin text not null, channel text not null default 'web', place text, archived_at timestamptz, created_at timestamptz not null default now(), unique (agent_id, key))`.execute(db)
  await sql`alter table agent add column if not exists notify text`.execute(db)
  await sql`create table if not exists thread_turn (id text primary key, thread_id text not null, created_at timestamptz not null default now())`.execute(db)
  await sql`create table if not exists thread_chunk (turn_id text not null references thread_turn(id) on delete cascade, seq integer not null, chunk jsonb not null, primary key (turn_id, seq))`.execute(db)
}
