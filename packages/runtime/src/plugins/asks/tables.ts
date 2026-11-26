import { sql, type Kysely } from 'kysely'
import type { Database } from '../../server/platform/db-schema.ts'
import { allowOnly } from '../../server/platform/db.ts'

export async function createTables(db: Kysely<Database>): Promise<void> {
  await sql`create table if not exists change_request (
    id text primary key, agent_id text not null references agent(id) on delete cascade, action text not null, input text not null, summary text not null,
    why text not null, origin text not null, status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'expired')), note text,
    told boolean not null default false, created_at timestamptz not null default now(), decided_at timestamptz, expires_at timestamptz, result text)`.execute(db)
  await sql`create index if not exists change_request_by_agent on change_request (agent_id, created_at desc)`.execute(db)
  await sql`alter table change_request add column if not exists expires_at timestamptz, add column if not exists result text`.execute(db)
  await allowOnly({ table: 'change_request', column: 'status', values: ['pending', 'approved', 'denied', 'expired'] })
}
