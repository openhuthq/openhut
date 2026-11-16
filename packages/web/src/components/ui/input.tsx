import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const inputVariants = cva('w-full border border-hair bg-card px-3 py-0 text-ink', {
  variants: {
    variant: {
      default: 'h-8 rounded-lg focus-visible:rounded-md',
      lg: 'h-11 rounded-[10px] border-mid [transition:border-color_.15s,box-shadow_.15s] focus:border-ink focus:shadow-[0_0_0_3px_oklch(0%_0_0/.08)] focus:outline-none',
      title: 'h-auto rounded-none border-0 border-b bg-transparent px-0 py-1 text-[18px] font-medium focus:border-b-ink focus:outline-none',
      chip: 'h-7 w-auto rounded-full',
    },
    mono: { true: 'font-mono text-[12px]', false: '' },
  },
  defaultVariants: { variant: 'default', mono: false },
})

export function Input({ className, variant, mono, ...props }: ComponentProps<'input'> & VariantProps<typeof inputVariants>) {
  return <input data-slot="input" className={cn(inputVariants({ variant, mono }), className)} {...props} />
}
