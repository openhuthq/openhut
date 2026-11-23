import type { ColumnType, Generated } from 'kysely'
import type { ConnectionKind } from '@openhut/common/connections/connection.ts'

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>

export interface Database {
  install_setting: { name: string; value: string }
  person: { id: string; email: string; role: 'owner' | 'admin' | 'member'; created_at: Timestamp; removed_at: Timestamp | null }
  agent: {
    id: string; name: string; owner_id: string; instructions: string; model: string; fallback_model: string | null; helper_models: Generated<string>; net: number
    wanted: Generated<'running' | 'stopped'>; code_execution: Generated<boolean>; web_browser: Generated<boolean>; face: Generated<string | null>; token_epoch: Generated<number>; channel_key: string; created_at: Timestamp
    runs_on: Generated<string | null>; changed_by: Generated<string | null>; workspace: Generated<string | null>; shared: Generated<boolean>; owner: Generated<string | null>; owner_proof: Generated<string | null>
  }
  channel: { id: string; agent_id: string; kind: 'slack' | 'whatsapp' | 'telegram'; status: 'connected' | 'linking'; account: string | null; owner_address: string; secrets: string; open: boolean; allowed: string; created_at: Timestamp }
  connection: {
    id: string; kind: ConnectionKind; name: string; account: Generated<string>; sign_in: Generated<boolean>; owner_id: string; config: string
    everyone: Generated<boolean>; created_at: Timestamp; changed_by: Generated<string | null>
  }
  connection_grant: { id: string; connection_id: string; agent_id: string; created_at: Timestamp }
  thread: { id: string; agent_id: string; person_id: string; title: string; messages: Generated<string>; created_at: Timestamp; updated_at: Timestamp }
  routine: {
    id: string; agent_id: string; name: string; plan: string; at: Timestamp | null; cron: string | null; until: Timestamp | null; origin: string
    next_run_at: Timestamp | null; created_at: Generated<Date>; run_id: string | null; run_status: 'open' | 'told' | 'quiet' | 'failed' | null
    run_picked_at: Timestamp | null; run_at: Timestamp | null; run_text: string | null; failures: Generated<number>
  }
  connection_event: {
    id: Generated<string>; at: Timestamp; agent_id: string; connection_id: string | null; tool: string; reason: string
    outcome: 'allowed' | 'denied' | 'failed'; ms: number
  }
  record_held: { id: string; ver: number; parent: string | null }
  record_outbox: { seq: Generated<string>; id: string; collection: string; workspace: string; parent: string | null; body: string; deleted: Generated<boolean> }
}
