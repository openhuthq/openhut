import { sql, type Kysely } from 'kysely'
import type { Database } from '../../server/platform/db-schema.ts'
import { GIT_TOOLS } from '../../server/integrations/github/github.ts'

export async function createTables(db: Kysely<Database>): Promise<void> {
  await sql`create table if not exists github_face (agent_id text primary key references agent(id) on delete cascade, sha256 text not null, png text not null, url text)`.execute(db)
  await sql`create table if not exists github_thread (agent_id text not null references agent(id) on delete cascade, thread text not null, primary key (agent_id, thread))`.execute(db)
  await sql`create table if not exists github_install_wait (ask_id text primary key references ask(id) on delete cascade, actor text not null, permissions text not null, known text not null, created_at timestamptz not null default now())`.execute(db)
  await splitGitPermission(db)
}

export async function splitGitPermission(db: Kysely<Database>): Promise<void> {
  const old = await db.selectFrom('tool_permission').selectAll().where('tool', '=', 'git_credentials').execute()
  if (!old.length) return
  const rows = old.filter((row) => row.state !== 'ask').flatMap((row) => GIT_TOOLS.map((tool) => ({ ...row, tool })))
  if (rows.length) await db.insertInto('tool_permission').values(rows).onConflict((oc) => oc.columns(['agent_id', 'connection_id', 'tool']).doNothing()).execute()
  await db.deleteFrom('tool_permission').where('tool', '=', 'git_credentials').execute()
}
