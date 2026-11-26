import { sql, type Kysely } from 'kysely'
import type { Database } from '../../server/platform/db-schema.ts'

export async function createTables(db: Kysely<Database>): Promise<void> {
  await sql`create table if not exists github_face (agent_id text primary key references agent(id) on delete cascade, sha256 text not null, png text not null, url text)`.execute(db)
  await sql`create table if not exists github_thread (agent_id text not null references agent(id) on delete cascade, thread text not null, primary key (agent_id, thread))`.execute(db)
}
