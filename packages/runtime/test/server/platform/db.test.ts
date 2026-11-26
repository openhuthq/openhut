import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'kysely'
import { db, migrate } from '../../../src/server/platform/db.ts'
import { permissions } from '../../../src/server/permissions/permissions.ts'

const BUILD_499 = `
create table person (
  id text primary key, email text unique not null, name text not null default '', pass text, role text not null check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(), removed_at timestamptz);
create table agent (
  id text primary key, name text not null, owner_id text not null references person(id), instructions text not null,
  model text not null default 'claude:sonnet', net integer unique not null check (net between 1 and 250),
  wanted text not null default 'stopped' check (wanted in ('running', 'stopped')),
  channel_key text not null, created_at timestamptz not null default now(),
  code_execution boolean not null default true, web_browser boolean not null default false, face text,
  size text not null default 'standard' check (size in ('standard', 'large', 'xlarge')), token_epoch integer not null default 0,
  fallback_model text, helper_models text not null default '{}', runs_on text, changed_by text, workspace text,
  shared boolean not null default false, owner text, people text not null default '[]');
create table channel (
  id text primary key, agent_id text not null references agent(id) on delete cascade, kind text not null check (kind in ('slack')),
  status text not null check (status in ('connected', 'linking')), account text, owner_address text not null, secrets text not null default '',
  open boolean not null default false, allowed text not null default '', created_at timestamptz not null default now(), unique (agent_id, kind));
create table connection (
  id text primary key, kind text not null check (kind in ('postgres')),
  name text not null, owner_id text not null references person(id), config text not null, everyone boolean not null default false,
  created_at timestamptz not null default now(), account text not null default '', sign_in boolean not null default false, changed_by text);
create table connection_event (
  id bigserial primary key, at timestamptz not null default now(), agent_id text not null, connection_id text, tool text not null,
  reason text not null, outcome text not null check (outcome in ('allowed', 'denied', 'failed')), ms integer not null);
create table change_request (
  id text primary key, agent_id text not null references agent(id) on delete cascade, action text not null, input text not null, summary text not null,
  why text not null, origin text not null, status text not null default 'pending' check (status in ('pending', 'approved', 'denied')), note text,
  told boolean not null default false, created_at timestamptz not null default now(), decided_at timestamptz);
insert into person (id, email, role) values ('usr_old00001', 'old@example.com', 'owner');
insert into agent (id, name, owner_id, instructions, net, channel_key) values ('agt_old00001', 'Old', 'usr_old00001', '', 1, 'k');
insert into connection (id, kind, name, owner_id, config) values ('con_old00001', 'postgres', 'Old db', 'usr_old00001', '{}')`

test('a database from build 0.6.499 upgrades at startup and keeps its rows', async () => {
  for (const statement of BUILD_499.split(';')) await sql.raw(statement).execute(db)
  await migrate()
  await migrate()

  const actor = { id: 'usr_old00001', email: 'old@example.com', role: 'owner' as const }
  const spec = { name: 'drop_table', description: '', schema: {} }
  assert.equal(await permissions.decide({ agentId: 'agt_old00001', connectionId: 'con_old00001', spec }), 'ask')
  await permissions.set({ actor, agentId: 'agt_old00001', connectionId: 'con_old00001', tools: ['drop_table'], state: 'deny' })
  assert.equal(await permissions.decide({ agentId: 'agt_old00001', connectionId: 'con_old00001', spec }), 'deny')

  await db.insertInto('connection_event').values({ agent_id: 'agt_old00001', connection_id: 'con_old00001', tool: 'drop_table', reason: '', outcome: 'asked', ms: 1, approved_by: actor.id }).execute()
  await db.insertInto('change_request').values({ id: 'chg_old00001', agent_id: 'agt_old00001', action: 'rename', input: '{}', summary: '', why: '', origin: '', status: 'expired', expires_at: new Date(), result: 'late' }).execute()
  await db.insertInto('connection').values({ id: 'con_old00002', kind: 'github', name: 'GitHub', owner_id: actor.id, config: '{}' }).execute()
  await sql`insert into channel (id, agent_id, kind, status, owner_address) values ('chn_old00001', 'agt_old00001', 'telegram', 'linking', '')`.execute(db)
  await assert.rejects(sql`insert into connection_event (agent_id, tool, reason, outcome, ms) values ('agt_old00001', 't', '', 'maybe', 1)`.execute(db))
  assert.equal((await db.selectFrom('agent').select('name').where('id', '=', 'agt_old00001').executeTakeFirstOrThrow()).name, 'Old')
})
