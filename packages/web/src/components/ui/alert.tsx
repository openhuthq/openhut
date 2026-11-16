import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const alertVariants = cva('', {
  variants: {
    variant: {
      error: 'm-0 rounded-md bg-[color-mix(in_oklch,var(--fail)_12%,transparent)] px-3 py-2 text-ink',
      'error-outline': 'mt-1.5 ml-10 flex flex-wrap items-center gap-2.5 rounded-[9px] border-[1.5px] border-[oklch(80%_.08_27)] bg-[oklch(97%_.02_27)] px-2.5 py-2 text-sm text-fail',
      'error-text': 'm-0 border-t border-hair px-5 py-2.5 text-sm text-fail',
      warning: 'mx-auto mt-0 mb-2 max-w-[720px] rounded-[9px] bg-warning-subtle px-3 py-2 text-sm/[1.45] text-warning-strong [&_a]:font-medium [&_a]:text-inherit [&_a]:underline [&_a]:underline-offset-2',
      note: 'flex flex-wrap items-start gap-2 border-t border-hair bg-canvas px-5 py-3 text-sm text-body [&>svg]:mt-px [&>svg]:size-[15px] [&>svg]:shrink-0 [&>svg]:text-pass [&>span]:min-w-0 [&>span]:flex-1',
      'note-warning': 'flex flex-wrap items-start gap-2 border-t border-hair bg-warning-subtle px-5 py-3 text-sm text-warning-foreground [&>svg]:mt-px [&>svg]:size-[15px] [&>svg]:shrink-0 [&>svg]:text-warning-foreground [&>span]:min-w-0 [&>span]:flex-1',
      success: 'flex animate-[grow_.3s_cubic-bezier(.2,.8,.2,1)] items-center gap-4 rounded-[14px] bg-success-subtle px-5 py-[18px] shadow-[inset_0_0_0_1px_oklch(70%_.1_155/.35)] tiny:flex-wrap',
      dashed: 'm-0 flex items-center gap-2.5 rounded-lg border border-dashed border-mid px-3 py-2.5 text-body',
    },
  },
  defaultVariants: { variant: 'error' },
})

export function Alert({ className, variant, ...props }: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />
}
