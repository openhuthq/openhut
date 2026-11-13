import type { ReactNode } from 'react'

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="shead"><h3>{title}</h3>{action}</div>
}
