import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const BUTTON = 'inline-flex items-center gap-1.5 rounded-md border-0 text-sm font-medium whitespace-nowrap no-underline not-disabled:active:scale-[.96]'

const variants = cva('', {
  variants: {
    variant: {
      ghost: 'bg-transparent text-ink not-disabled:hover:bg-soft',
      primary: 'bg-primary text-white not-disabled:hover:bg-primary-hover',
      secondary: 'bg-soft text-ink not-disabled:hover:bg-mid',
      danger: 'bg-transparent text-fail not-disabled:hover:bg-[oklch(55%_.185_27/.08)] not-disabled:hover:text-fail',
      destructive: 'bg-fail text-white not-disabled:hover:brightness-[.92]',
      send: 'grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-primary text-white',
      text: 'inline-flex items-center gap-1 border-0 bg-transparent p-0 text-sm font-medium text-ink no-underline underline-offset-2 not-disabled:hover:underline',
      link: 'border-0 bg-transparent p-0 text-inherit underline underline-offset-2',
      bare: 'm-0 border-0 bg-transparent p-0 text-left text-inherit',
    },
    size: {
      default: 'h-8 px-3',
      sm: 'h-7 px-2.5',
      xs: 'h-6 px-2.5',
      lg: 'h-11 justify-center rounded-lg px-3',
      icon: 'size-8 justify-center px-0',
      'icon-sm': 'size-7 justify-center px-0',
      'icon-xs': 'size-[26px] justify-center px-0',
      none: '',
    },
  },
  compoundVariants: [
    { size: ['icon', 'icon-sm', 'icon-xs'], class: 'text-mute not-disabled:hover:text-ink' },
    { variant: 'danger', size: ['icon', 'icon-sm', 'icon-xs'], class: 'not-disabled:hover:text-fail' },
  ],
  defaultVariants: { variant: 'ghost', size: 'default' },
})

export type ButtonVariants = VariantProps<typeof variants>

export function buttonVariants({ variant = 'ghost', size }: ButtonVariants = {}) {
  const plain = variant === 'send' || variant === 'link' || variant === 'bare' || variant === 'text'
  return cn(!plain && BUTTON, variants({ variant, size: size ?? (plain ? 'none' : 'default') }))
}

export function Button({ className, variant, size, ...props }: ComponentProps<'button'> & ButtonVariants) {
  return <button data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
