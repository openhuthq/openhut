import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const cardVariants = cva('bg-card', {
  variants: {
    variant: {
      box: 'rounded-lg border border-hair',
      tile: 'flex flex-col gap-2.5 rounded-lg border border-hair p-4 text-inherit no-underline [transition:border-color_.15s] hover:border-mid',
      ring: 'rounded-lg shadow-[inset_0_0_0_1px_var(--hair)]',
      preview: 'relative block min-h-[200px] w-full flex-1 cursor-zoom-in overflow-hidden rounded-lg border border-hair p-0 text-left text-inherit [transition:border-color_.15s,box-shadow_.15s] hover:border-mid hover:shadow-[0_4px_16px_oklch(0%_0_0/.06)]',
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

export function CardButton({ className, variant, ...props }: ComponentProps<'button'> & VariantProps<typeof cardVariants>) {
  return <button data-slot="card" className={cn(cardVariants({ variant }), className)} {...props} />
}
