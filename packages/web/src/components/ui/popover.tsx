import type { ComponentProps } from 'react'
import { Popover as PopoverPrimitive } from '@base-ui/react/popover'
import { cn } from '@/lib/utils'

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger

export function PopoverContent({ className, align = 'end', side = 'bottom', sideOffset = 6, initialFocus, ...props }: ComponentProps<typeof PopoverPrimitive.Popup> & Pick<ComponentProps<typeof PopoverPrimitive.Positioner>, 'align' | 'side' | 'sideOffset'>) {
  return <PopoverPrimitive.Portal>
    <PopoverPrimitive.Positioner className="z-10" align={align} side={side} sideOffset={sideOffset}>
      <PopoverPrimitive.Popup initialFocus={initialFocus} className={cn('-mt-[.5px] flex w-[340px] max-w-[calc(100vw-24px)] flex-col gap-3.5 rounded-xl border border-hair bg-card p-4 shadow-pop outline-none', className)} {...props} />
    </PopoverPrimitive.Positioner>
  </PopoverPrimitive.Portal>
}
