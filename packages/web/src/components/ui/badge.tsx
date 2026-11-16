import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const STATUS = 'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-2 py-0.5 text-xs/4 font-medium whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:size-3 [&_svg]:shrink-0'

export const badgeVariants = cva('', {
  variants: {
    variant: {
      secondary: 'bg-badge-secondary text-badge-secondary-foreground',
      destructive: 'bg-badge-destructive text-white',
      outline: 'border-badge-outline text-badge-outline-foreground',
      success: 'bg-success-subtle text-success-foreground',
      warning: 'bg-warning-subtle text-warning-foreground',
      tag: 'rounded-md bg-soft px-[7px] py-px text-[11px] font-medium text-mute',
      'tag-success': 'rounded-md bg-success-subtle px-[7px] py-px text-[11px] font-medium text-success-foreground',
      count: 'shrink-0 rounded-[5px] bg-soft px-[5px] text-xs font-medium text-mute',
      chip: 'inline-flex h-7 items-center gap-1.5 rounded-full bg-canvas px-2.5 text-sm font-medium text-body shadow-[inset_0_0_0_1px_var(--hair)] [&_svg]:size-[13px] [&_svg]:text-ink',
    },
  },
  compoundVariants: [{ variant: ['secondary', 'destructive', 'outline', 'success', 'warning'], class: STATUS }],
  defaultVariants: { variant: 'secondary' },
})

export function Badge({ className, variant, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}
