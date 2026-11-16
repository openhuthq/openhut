import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Empty({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="empty" className={cn('grid place-items-center gap-3 py-16 text-center text-mute', className)} {...props} />
}
