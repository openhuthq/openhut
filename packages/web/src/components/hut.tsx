import hut from '@/hut.svg?raw'
import { cn } from '@/lib/utils'

export function Hut({ className }: { className?: string }) {
  return <span data-slot="hut" className={cn('block shrink-0 [&>svg]:block [&>svg]:size-full [&>svg]:origin-bottom [&>svg]:overflow-visible', className)} aria-hidden="true" dangerouslySetInnerHTML={{ __html: hut }} />
}
