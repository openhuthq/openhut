import { cn } from '@/lib/utils'

export function TeamMark({ name, className }: { name: string; className?: string }) {
  return <span aria-hidden="true" className={cn('grid size-[26px] shrink-0 place-items-center rounded-md bg-ink text-[13px] font-semibold text-white', className)}>{name.trim().charAt(0).toUpperCase()}</span>
}
