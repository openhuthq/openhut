import type { ReactNode } from 'react'
import { cardVariants } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export function Facts({ boxed = true, className, children }: { boxed?: boolean; className?: string; children: ReactNode }) {
  return <div className={cn(boxed && cardVariants(), 'py-2', className)}>{children}</div>
}

export function Fact({ label, icon, title, children }: { label: ReactNode; icon?: ReactNode; title?: string; children: ReactNode }) {
  return <div className="flex min-h-8 items-center justify-between gap-3 px-4"><span className="inline-flex shrink-0 items-center gap-2 text-mute" title={title}>{icon}{label}</span>{children}</div>
}
