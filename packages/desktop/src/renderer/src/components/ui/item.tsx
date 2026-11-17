import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const itemGroupVariants = cva('bg-card', {
  variants: {
    variant: {
      box: 'rounded-lg border border-hair [&>*+*]:border-t-[0.5px] [&>*+*]:border-hair [&>:first-child]:rounded-t-[7px] [&>:last-child]:rounded-b-[7px]',
      ring: 'm-0 list-none rounded-lg p-0 shadow-[inset_0_0_0_1px_var(--hair)] [&>*+*]:border-t [&>*+*]:border-hair [&>:first-child]:rounded-t-lg [&>:last-child]:rounded-b-lg',
      inset: 'rounded-lg px-4 shadow-[inset_0_0_0_1px_var(--hair)] [&>[data-slot=item]+[data-slot=item]]:border-t [&>[data-slot=item]+[data-slot=item]]:border-hair',
    },
  },
  defaultVariants: { variant: 'box' },
})

export function ItemGroup({ className, variant, ...props }: ComponentProps<'div'> & VariantProps<typeof itemGroupVariants>) {
  return <div data-slot="item-group" className={cn(itemGroupVariants({ variant }), className)} {...props} />
}

export const itemVariants = cva('flex min-w-0 items-center', {
  variants: {
    size: {
      default: 'min-h-12 gap-3 px-4 py-2',
      sm: 'min-h-11 gap-2.5 px-3 py-1.5',
      md: 'min-h-16 gap-3 py-3',
      lg: 'min-h-[66px] gap-3 px-4 py-3 text-sm tracking-[-.13px] text-ink no-underline',
      catalog: '-mx-2 h-14 gap-3 rounded-md border-0 bg-transparent px-2 text-left text-sm tracking-[-.13px] text-ink no-underline not-disabled:hover:bg-tint disabled:opacity-55',
    },
    interactive: { true: '', false: '' },
  },
  compoundVariants: [{ size: 'lg', interactive: true, class: 'hover:bg-[oklch(0%_0_0/.02)] focus-visible:bg-[oklch(0%_0_0/.02)] focus-visible:outline-none' }],
  defaultVariants: { size: 'default', interactive: false },
})

export function Item({ className, size, interactive, ...props }: ComponentProps<'div'> & VariantProps<typeof itemVariants>) {
  return <div data-slot="item" className={cn(itemVariants({ size, interactive }), className)} {...props} />
}

export function ItemContent({ className, stacked = false, ...props }: ComponentProps<'div'> & { stacked?: boolean }) {
  return <div data-slot="item-content" className={cn('min-w-0 flex-1', stacked && 'flex flex-col gap-0.5', className)} {...props} />
}

const itemTitleVariants = cva('flex min-w-0 items-center font-medium', {
  variants: { size: { default: 'gap-2', catalog: 'gap-1.5 leading-[16.25px]' } },
  defaultVariants: { size: 'default' },
})

export function ItemTitle({ className, size, ...props }: ComponentProps<'span'> & VariantProps<typeof itemTitleVariants>) {
  return <span data-slot="item-title" className={cn(itemTitleVariants({ size }), className)} {...props} />
}

const itemDescriptionVariants = cva('truncate', {
  variants: { size: { default: 'text-mute', catalog: 'leading-[16.25px] font-book text-mute-2' } },
  defaultVariants: { size: 'default' },
})

export function ItemDescription({ className, size, ...props }: ComponentProps<'span'> & VariantProps<typeof itemDescriptionVariants>) {
  return <span data-slot="item-description" className={cn(itemDescriptionVariants({ size }), className)} {...props} />
}
