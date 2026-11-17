import type { ComponentProps } from 'react'
import { Meter as MeterPrimitive } from '@base-ui/react/meter'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const meterVariants = cva('overflow-hidden', {
  variants: {
    size: { sm: 'h-1.5 rounded-[3px] bg-hair', xs: 'h-1 w-14 rounded-full bg-soft' },
  },
  defaultVariants: { size: 'sm' },
})

export function Meter({ className, size, full = false, ...props }: ComponentProps<typeof MeterPrimitive.Root> & VariantProps<typeof meterVariants> & { full?: boolean }) {
  return <MeterPrimitive.Root className={cn(meterVariants({ size }), className)} {...props}>
    <MeterPrimitive.Indicator className={cn('block h-full', full ? 'bg-fail' : 'bg-ink', size !== 'xs' && 'rounded-[3px]')} />
  </MeterPrimitive.Root>
}
