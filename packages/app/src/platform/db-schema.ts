import type { ColumnType, Generated } from 'kysely'
import type { ConnectionKind } from '@fastmonkey/common/connections/connection.ts'

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>

export interface Database {
  install_setting: { name: string; value: string }
  person: { id: string; email: string; pass: string; role: 'owner' | 'admin' | 'member'; created_at: Timestamp; removed_at: Timestamp | null }
  session: { hash: string; person_id: string; expires_at: Timestamp }
  invite: { id: string; hash: string; role: 'admin' | 'member'; created_by: string; expires_at: Timestamp; used_at: Timestamp | null }
  oauth_client: { id: string; name: string; redirect_uris: string; created_at: Timestamp }
  oauth_code: { code_hash: string; client_id: string; person_id: string; redirect_uri: string; challenge: string; expires_at: Timestamp }
  oauth_grant: { id: string; client_id: string; person_id: string; access_hash: string; refresh_hash: string; access_expires_at: Timestamp; created_at: Timestamp; used_at: Timestamp | null }
  agent: {
    id: string; name: string; owner_id: string; instructions: string; model: 'opus' | 'sonnet' | 'haiku'; net: number
    wanted: Generated<'running' | 'stopped'>; channel_key: string; created_at: Timestamp
  }
  channel: { id: string; agent_id: string; kind: 'slack' | 'whatsapp'; status: 'connected' | 'linking'; account: string | null; owner_address: string; secrets: string; open: boolean; allowed: string; created_at: Timestamp }
  connection: {
    id: string; kind: ConnectionKind; name: string; account: Generated<string>; sign_in: Generated<boolean>; owner_id: string; config: string
    everyone: Generated<boolean>; created_at: Timestamp
  }
  connection_grant: { id: string; connection_id: string; agent_id: string; created_at: Timestamp }
  connection_event: {
    id: Generated<string>; at: Timestamp; agent_id: string; connection_id: string | null; tool: string; reason: string
    outcome: 'allowed' | 'denied' | 'failed'; ms: number
  }
}
