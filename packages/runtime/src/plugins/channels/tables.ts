import { sql, type Kysely } from 'kysely'
import type { Database } from '../../server/platform/db-schema.ts'
import { allowOnly } from '../../server/platform/db.ts'
import { ChannelKind } from '@openhut/common/channels/channel.ts'

export async function createTables(db: Kysely<Database>): Promise<void> {
  await sql`create table if not exists channel (
    id text primary key, agent_id text not null references agent(id) on delete cascade,
    kind text not null check (kind in (${sql.join(ChannelKind.options.map((kind) => sql.lit(kind)))})),
    status text not null check (status in ('connected', 'linking')), account text, owner_address text not null, secrets text not null default '',
    open boolean not null default false, allowed text not null default '', created_at timestamptz not null default now(), unique (agent_id, kind))`.execute(db)
  await sql`create table if not exists telegram_code (
    hash text primary key, channel_id text not null, agent_id text not null, kind text not null check (kind in ('claim', 'invite')),
    sealed text, expires_at timestamptz not null)`.execute(db)
  await allowOnly({ table: 'channel', column: 'kind', values: ChannelKind.options })
}
