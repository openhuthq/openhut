import type { ColumnType, Generated } from 'kysely'
import type { ConnectionKind } from '@openhut/common/connections/connection.ts'

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>

export interface Database {
  install_setting: { name: string; value: string }
  person: { id: string; email: string; name: Generated<string>; pass: string | null; role: 'owner' | 'admin' | 'member'; created_at: Timestamp; removed_at: Timestamp | null }
  session: { hash: string; person_id: string; expires_at: Timestamp }
  invite: { hash: string; role: 'admin' | 'member'; created_by: string; expires_at: Timestamp }
  password_reset: { hash: string; person_id: string; expires_at: Timestamp }
  computer: { id: string; name: string; token_hash: string; expires_at: Timestamp | null; version: string | null; gvisor: boolean | null; update_error: string | null; seen_at: Timestamp | null; created_at: Generated<Date> }
  agent: {
    id: string; name: string; owner_id: string; instructions: string; model: string; fallback_model: string | null; helper_models: Generated<string>; net: number
    wanted: Generated<'running' | 'stopped'>; code_execution: Generated<boolean>; web_browser: Generated<boolean>; face: Generated<string | null>; token_epoch: Generated<number>; channel_key: string; created_at: Timestamp
    runs_on: Generated<string | null>; changed_by: Generated<string | null>; workspace: Generated<string | null>; shared: Generated<boolean>; people: Generated<string>; owner: Generated<string | null>
    notify: Generated<string | null>
  }
  channel: { id: string; agent_id: string; kind: 'slack' | 'whatsapp' | 'telegram' | 'discord'; status: 'connected' | 'linking'; account: string | null; owner_address: string; secrets: string; open: boolean; allowed: string; created_at: Timestamp }
  connection: {
    id: string; kind: ConnectionKind; name: string; account: Generated<string>; sign_in: Generated<boolean>; owner_id: string; config: string
    everyone: Generated<boolean>; created_at: Timestamp; changed_by: Generated<string | null>; reconnected_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
  }
  connection_grant: { id: string; connection_id: string; agent_id: string; created_at: Timestamp }
  connection_event: {
    id: Generated<string>; at: Timestamp; agent_id: string; connection_id: string | null; tool: string; reason: string
    outcome: 'allowed' | 'asked' | 'denied' | 'failed'; ms: number; approved_by: Generated<string | null>; problem: Generated<'auth' | null>
  }
  tool_permission: { agent_id: string; connection_id: string; tool: string; state: 'allow' | 'ask' | 'deny'; changed_by: string; changed_at: Generated<Date> }
  record: { key: string; collection: string; id: string; workspace: string; parent: string | null; ver: number; value: string; secret: string | null; personal: boolean; deleted: boolean }
  chat_thread: { id: string; agent_id: string; key: string | null; title: string; origin: string; mirrors: string; mirror_paused: Generated<boolean>; continue_url: Generated<string | null>; web_streak: Generated<number>; archived_at: ColumnType<Date | null, Date | null | undefined, Date | null>; created_at: Generated<Date> }
  github_face: { agent_id: string; sha256: string; png: string; url: string | null }
  github_thread: { agent_id: string; thread: string }
  github_install_wait: { ask_id: string; actor: string; permissions: string; known: string; created_at: Generated<Date> }
  agent_secret: { id: string; agent_id: string; name: string; hosts: string; header: string; value: string; created_at: Generated<Date>; used_at: Timestamp | null }
  telegram_code: { hash: string; channel_id: string; agent_id: string; kind: 'claim' | 'invite'; sealed: string | null; expires_at: Timestamp }
  inbox_source: {
    id: string; agent_id: string; kind: 'schedule' | 'webhook'; name: string; origin: string; created_at: Generated<Date>
    plan: Generated<string>; at: Timestamp | null; cron: string | null; until: Timestamp | null; next_run_at: Timestamp | null
    run_id: string | null; run_status: 'open' | 'told' | 'quiet' | 'failed' | null; run_picked_at: Timestamp | null; run_at: Timestamp | null
    run_text: string | null; failures: Generated<number>; secret: string | null; last_at: Timestamp | null
    threads: Generated<'group' | 'each'>
    filter: string | null; fingerprint: string | null; thread: string | null; card: string | null; skipped: Generated<number>
  }
  inbox_thread: { source_id: string; group_key: string; thread_id: string }
  inbox_item: {
    id: string; source_id: string; agent_id: string; fingerprint: string | null; text: string; group_key: string | null; told: Generated<boolean>; created_at: Generated<Date>
    seen: Generated<number>; last_at: Timestamp | null; sample: string | null; thread_id: string | null; message_id: string | null
  }
  sign_in: {
    state: string; actor: string; actor_id: string; kind: string; name: string; existing_id: string | null; data: string
    status: 'pending' | 'working' | 'done' | 'failed'; connection_id: Generated<string | null>; error: Generated<string | null>; expires_at: Timestamp; created_at: Generated<Date>
  }
  ask: {
    id: string; agent_id: string; kind: string; input: string; title: string; why: string; origin: string
    status: Generated<'open' | 'done' | 'declined' | 'expired'>; note: string | null; reply: string | null; told: Generated<boolean>; created_at: Generated<Date>
    answered_at: Timestamp | null; expires_at: Timestamp | null; wake_id: string | null
  }
}
