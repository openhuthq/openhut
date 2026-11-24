import type { ComponentProps } from 'react'
import { Select as SelectPrimitive } from '@base-ui/react/select'
import { PHONE_SHEET } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export const Select = SelectPrimitive.Root

export function SelectTrigger({ className, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger className={cn('inline-flex h-7 min-w-[136px] cursor-pointer items-center gap-1.5 rounded-md border-0 bg-soft pr-2 pl-2.5 text-sm font-medium select-none not-disabled:hover:bg-mid data-popup-open:bg-mid [&>span]:flex-1 [&>span]:text-left [&>svg:last-child]:text-mute', className)} {...props} />
}

export function SelectContent({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Popup>) {
  return <SelectPrimitive.Portal>
    <SelectPrimitive.Backdrop className={PHONE_SHEET.backdrop} />
    <SelectPrimitive.Positioner className={cn('z-50', PHONE_SHEET.positioner)} side="bottom" align="end" sideOffset={6} alignItemWithTrigger={false}>
      <SelectPrimitive.Popup className={cn(PHONE_SHEET.popup, 'w-72 origin-top-right animate-[grow_.14s_cubic-bezier(.2,.8,.2,1)] rounded-lg bg-card p-1.5 shadow-[0_0_0_1px_var(--hair),0_12px_32px_oklch(0%_0_0/.14)] outline-none', className)} {...props}>
        <SelectPrimitive.List>{children}</SelectPrimitive.List>
      </SelectPrimitive.Popup>
    </SelectPrimitive.Positioner>
  </SelectPrimitive.Portal>
}

export function SelectItem({ className, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item className={cn('flex w-full cursor-pointer items-center gap-2.5 rounded-md border-0 bg-transparent p-2 text-left text-ink outline-none data-highlighted:bg-soft phone:min-h-12 phone:rounded-xl phone:px-3', className)} {...props} />
}


export function SelectFooter({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('-mx-1.5 mt-1.5 -mb-1.5 border-t border-hair px-3.5 py-2 text-xs text-mute', className)} {...props} />
}
