import type { ComponentProps } from 'react'
import { Separator as SeparatorPrimitive } from '@base-ui/react/separator'
import { cn } from '@/lib/utils'

export function Separator({ className, orientation = 'horizontal', ...props }: ComponentProps<typeof SeparatorPrimitive>) {
  return <SeparatorPrimitive orientation={orientation} className={cn('shrink-0 bg-hair', orientation === 'vertical' ? 'h-4 w-px' : 'h-px', className)} {...props} />
}
