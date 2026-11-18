import type { ColumnType, Generated } from 'kysely'
import type { ConnectionKind } from '@openhut/common/connections/connection.ts'

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>

export interface Database {
  install_setting: { name: string; value: string }
  person: { id: string; email: string; role: 'owner' | 'admin' | 'member'; created_at: Timestamp; removed_at: Timestamp | null }
  agent: {
    id: string; name: string; owner_id: string; instructions: string; model: string; fallback_model: string | null; helper_models: Generated<string>; net: number
    wanted: Generated<'running' | 'stopped'>; code_execution: Generated<boolean>; web_browser: Generated<boolean>; token_epoch: Generated<number>; channel_key: string; created_at: Timestamp
  }
  channel: { id: string; agent_id: string; kind: 'slack' | 'whatsapp' | 'telegram'; status: 'connected' | 'linking'; account: string | null; owner_address: string; secrets: string; open: boolean; allowed: string; created_at: Timestamp }
  connection: {
    id: string; kind: ConnectionKind; name: string; account: Generated<string>; sign_in: Generated<boolean>; owner_id: string; config: string
    everyone: Generated<boolean>; created_at: Timestamp
  }
  connection_grant: { id: string; connection_id: string; agent_id: string; created_at: Timestamp }
  thread: { id: string; agent_id: string; person_id: string; title: string; messages: Generated<string>; created_at: Timestamp; updated_at: Timestamp }
  connection_event: {
    id: Generated<string>; at: Timestamp; agent_id: string; connection_id: string | null; tool: string; reason: string
    outcome: 'allowed' | 'denied' | 'failed'; ms: number
  }
}
