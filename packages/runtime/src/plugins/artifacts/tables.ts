import { sql, type Kysely } from 'kysely'
import type { Database } from '../../server/platform/db-schema.ts'

export async function createTables(db: Kysely<Database>): Promise<void> {
  await sql`create table if not exists artifact (
    id text primary key, agent_id text not null references agent(id) on delete cascade, created_by text not null, title text not null,
    access text not null default 'private' check (access in ('private', 'team', 'link')), people text[] not null default '{}',
    entry text not null default 'index.html', share_token text unique, ver integer not null default 1,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now())`.execute(db)
  await sql`create index if not exists artifact_agent on artifact (agent_id, updated_at desc)`.execute(db)
  await sql`create table if not exists artifact_file (
    artifact_id text not null references artifact(id) on delete cascade, path text not null, type text not null, body bytea not null,
    primary key (artifact_id, path))`.execute(db)
}
