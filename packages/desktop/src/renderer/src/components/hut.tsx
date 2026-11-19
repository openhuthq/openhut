import type { CSSProperties } from 'react'
import hut from '@/hut.svg?raw'
import { cn } from '@/lib/utils'

export function Hut({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span data-slot="hut" className={cn('block shrink-0 [&>svg]:block [&>svg]:size-full [&>svg]:origin-bottom [&>svg]:overflow-visible', className)} style={style} aria-hidden="true" dangerouslySetInnerHTML={{ __html: hut }} />
}
