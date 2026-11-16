import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function SectionHead({ title, count, description, action, flush = false, children }: { title?: string; count?: number; description?: string; action?: ReactNode; flush?: boolean; children?: ReactNode }) {
  if (description) return <div>
    <h3 className="m-0 text-sm font-semibold">{title}{count !== undefined && <> <span className="font-book text-mute">{count}</span></>}</h3>
    <p className="mt-0.5 mb-0 text-sm text-mute">{description}</p>
  </div>
  return <div className={cn('mb-2 flex min-h-7 min-w-0 items-center justify-between gap-3', flush && 'm-0')}>
    {title && <h3 className="m-0 shrink-0 text-sm font-medium tracking-[-.13px]">{title}{count !== undefined && <> <span className="text-sm font-book text-mute">{count}</span></>}</h3>}
    {children}{action}
  </div>
}
