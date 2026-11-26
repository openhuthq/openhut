import { sql, type Kysely } from 'kysely'
import type { Database } from '../../server/platform/db-schema.ts'

export async function createTables(db: Kysely<Database>): Promise<void> {
  await sql`create table if not exists agent_secret (
    id text primary key, agent_id text not null references agent(id) on delete cascade, name text not null, hosts text not null, header text not null,
    value text not null, created_at timestamptz not null default now(), used_at timestamptz, unique (agent_id, name))`.execute(db)
}
