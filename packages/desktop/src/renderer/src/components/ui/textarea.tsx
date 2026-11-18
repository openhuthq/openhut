import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const textareaVariants = cva('w-full bg-card text-ink', {
  variants: {
    variant: {
      editor: 'min-h-0 flex-1 resize-none rounded-none border-0 p-5 font-mono text-[14px] leading-[1.7] focus:outline-none',
      field: 'min-h-[120px] flex-none resize-y rounded-lg border border-hair px-3 py-2.5 font-sans text-[14px] leading-[1.5] font-normal focus:border-[oklch(0%_0_0/.32)] focus:outline-none',
      composer: 'max-h-60 min-h-8 min-w-0 flex-1 resize-none rounded-none border-0 bg-transparent px-0 py-[5px] font-sans text-[15px] leading-[1.5] outline-none disabled:cursor-not-allowed',
    },
  },
  defaultVariants: { variant: 'field' },
})

export function Textarea({ className, variant, ...props }: ComponentProps<'textarea'> & VariantProps<typeof textareaVariants>) {
  return <textarea data-slot="textarea" className={cn(textareaVariants({ variant }), className)} {...props} />
}
