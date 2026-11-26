import { createContext, use, type ComponentProps } from 'react'
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const groupVariants = cva('', {
  variants: {
    variant: {
      line: 'inline-flex items-center gap-4',
      segmented: 'inline-flex gap-0.5 rounded-lg bg-soft p-0.5',
      pill: 'flex flex-wrap items-center gap-1.5',
      card: 'grid grid-cols-2 gap-2 phone:grid-cols-1',
    },
  },
  defaultVariants: { variant: 'line' },
})

const itemVariants = cva('', {
  variants: {
    variant: {
      line: 'relative inline-flex h-8 items-center gap-1.5 border-0 bg-transparent px-0 text-[13px] font-medium text-mute hover:text-ink data-pressed:text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:bg-ink after:opacity-0 data-pressed:after:opacity-100',
      segmented: 'inline-flex h-6 items-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-sm font-medium text-mute hover:text-ink data-pressed:bg-card data-pressed:text-ink data-pressed:shadow-[inset_0_0_0_1px_var(--hair)]',
      pill: 'h-7 rounded-full border border-hair bg-card px-3 text-sm font-medium text-body data-pressed:border-ink data-pressed:bg-ink data-pressed:text-white',
      card: 'flex items-center gap-2.5 rounded-lg border border-hair bg-card px-3 py-2.5 text-left text-ink data-pressed:border-ink data-pressed:shadow-[inset_0_0_0_1px_var(--ink)]',
    },
  },
  defaultVariants: { variant: 'line' },
})

type Variant = VariantProps<typeof groupVariants>['variant']
const VariantContext = createContext<Variant>('line')

export function ToggleGroup({ className, variant, value, onPick, ...props }: Omit<ComponentProps<typeof ToggleGroupPrimitive>, 'value' | 'onValueChange'> & VariantProps<typeof groupVariants> & { value: string; onPick: (value: string) => void }) {
  return <VariantContext value={variant}>
    <ToggleGroupPrimitive className={cn(groupVariants({ variant }), className)} value={[value]} onValueChange={(next) => { if (next[0] !== undefined) onPick(next[0]) }} {...props} />
  </VariantContext>
}

export function ToggleGroupItem({ className, ...props }: ComponentProps<typeof Toggle>) {
  return <Toggle className={cn(itemVariants({ variant: use(VariantContext) }), className)} {...props} />
}
