import type { Connection } from '@fastmonkey/common/connections/connection.ts'
import { StatusBadge } from '@/components/status-badge'
import { ago } from '@/lib/format'

export function ConnectionHealth({ connection }: { connection: Connection }) {
  const tip = connection.lastSuccessAt ? `Last successful call ${ago(connection.lastSuccessAt)} ago` : undefined
  return <StatusBadge status={connection.status} tip={tip} />
}
