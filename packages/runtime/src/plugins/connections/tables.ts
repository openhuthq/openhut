import { sql, type Kysely } from 'kysely'
import type { Database } from '../../server/platform/db-schema.ts'
import { allowOnly } from '../../server/platform/db.ts'
import { CallOutcome, ConnectionKind } from '@openhut/common/connections/connection.ts'

export async function createTables(db: Kysely<Database>): Promise<void> {
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
  await sql`alter table connection_event add column if not exists approved_by text`.execute(db)
  await allowOnly({ table: 'connection_event', column: 'outcome', values: CallOutcome.options })
  await allowOnly({ table: 'connection', column: 'kind', values: ConnectionKind.options })
}
