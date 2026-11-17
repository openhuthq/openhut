import { createContext, use, type ComponentProps, type ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const groupVariants = cva('', {
  variants: {
    variant: {
      segmented: 'flex gap-1 rounded-lg bg-canvas p-[3px] shadow-[inset_0_0_0_1px_var(--hair)] tiny:flex-col',
      card: 'm-0 grid min-w-0 gap-1.5 border-0 p-0',
    },
  },
  defaultVariants: { variant: 'segmented' },
})

const itemVariants = cva('cursor-pointer', {
  variants: {
    variant: {
      segmented: 'relative flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md text-sm font-medium whitespace-nowrap text-mute has-checked:bg-card has-checked:text-ink has-checked:shadow-[0_1px_2px_oklch(0%_0_0/.1),inset_0_0_0_1px_var(--hair)] has-focus-visible:outline-2 has-focus-visible:outline-offset-1 has-focus-visible:outline-ink [&_svg]:size-[13px]',
      card: 'grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 gap-y-px rounded-lg px-3 py-2.5 text-sm shadow-[inset_0_0_0_1px_var(--hair)] hover:bg-tint has-checked:bg-tint has-checked:shadow-[inset_0_0_0_1.5px_var(--ink)]',
    },
  },
  defaultVariants: { variant: 'segmented' },
})

const inputVariants = cva('', {
  variants: {
    variant: {
      segmented: 'pointer-events-none absolute size-px opacity-0',
      card: 'row-span-2 m-0 mt-0.5 size-4 p-0 accent-primary',
    },
  },
})

type Group = { name: string; variant: VariantProps<typeof groupVariants>['variant'] }
const GroupContext = createContext<Group>({ name: '', variant: 'segmented' })

export function RadioGroup({ name, variant, className, children, ...props }: ComponentProps<'div'> & Group) {
  return <GroupContext value={{ name, variant }}><div role="radiogroup" className={cn(groupVariants({ variant }), className)} {...props}>{children}</div></GroupContext>
}

export function RadioGroupItem({ value, defaultChecked, disabled, title, className, children }: { value: string; defaultChecked?: boolean; disabled?: boolean; title?: string; className?: string; children: ReactNode }) {
  const { name, variant } = use(GroupContext)
  return <label className={cn(itemVariants({ variant }), className)} title={title}>
    <input type="radio" name={name} value={value} defaultChecked={defaultChecked} disabled={disabled} className={inputVariants({ variant })} />{children}
  </label>
}
