import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Spinner({ className, ...props }: ComponentProps<'span'>) {
  return <span aria-hidden="true" className={cn('mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border-2 border-soft border-t-ink', className)} {...props} />
}
