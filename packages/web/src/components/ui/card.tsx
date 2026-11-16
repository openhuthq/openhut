import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const cardVariants = cva('bg-card', {
  variants: {
    variant: {
      box: 'rounded-lg border border-hair',
      tile: 'flex flex-col gap-2.5 rounded-lg border border-hair p-4 text-inherit no-underline [transition:border-color_.15s] hover:border-mid',
      ring: 'rounded-lg shadow-[inset_0_0_0_1px_var(--hair)]',
    },
  },
  defaultVariants: { variant: 'box' },
})

export function Card({ className, variant, ...props }: ComponentProps<'div'> & VariantProps<typeof cardVariants>) {
  return <div data-slot="card" className={cn(cardVariants({ variant }), className)} {...props} />
}

export function CardHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex min-w-0 items-center gap-2.5 border-b border-hair px-4 py-3', className)} {...props} />
}
