import type { ReactNode } from 'react'
import { Hut } from '@/components/hut'
import type { Mood } from '@/lib/hut'
import { cn } from '@/lib/utils'

export function EmptyState({ line, action, inline, mood = 'looking', className }: { line: ReactNode; action?: ReactNode; inline?: boolean; mood?: Mood; className?: string }) {
  if (inline) return <div data-slot="empty-state" className={cn('flex items-center gap-2.5 px-2 py-1.5', className)}>
    <Hut mood={mood} className="size-6" />
    <p className="m-0 min-w-0 flex-1 text-[13px]/[18px] text-pretty text-mute">{line}</p>
    {action}
  </div>
  return <div data-slot="empty-state" className={cn('flex flex-col items-center gap-3 px-6 py-10 text-center', className)}>
    <Hut mood={mood} className="size-12" />
    <p className="m-0 max-w-[360px] text-[14px]/[1.5] text-balance text-body">{line}</p>
    {action}
  </div>
}
