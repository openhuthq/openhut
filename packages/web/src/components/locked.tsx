import type { ReactNode } from 'react'

export function Locked({ reason, children }: { reason?: string; children: ReactNode }) {
  if (!reason) return children
  return <span title={reason}>{children}</span>
}
