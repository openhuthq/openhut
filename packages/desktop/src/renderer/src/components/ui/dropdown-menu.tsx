import type { ComponentProps } from 'react'
import { Menu } from '@base-ui/react/menu'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger

export const menuPopupClass = 'max-w-(--available-width) min-w-[max(var(--anchor-width),224px)] origin-(--transform-origin) rounded-lg border border-hair bg-card p-1 text-sm shadow-menu outline-none [transition:opacity_.1s,scale_.1s] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0'

export const PHONE_SHEET = {
  backdrop: 'fixed inset-0 z-50 hidden bg-[oklch(0%_0_0/.25)] transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 phone:block',
  positioner: 'phone:!inset-auto phone:!right-2 phone:!bottom-[calc(8px+env(safe-area-inset-bottom))] phone:!left-2 phone:!transform-none',
  popup: 'phone:max-h-[min(70dvh,var(--available-height,70dvh))] phone:w-full phone:max-w-none phone:min-w-0 phone:origin-bottom phone:overflow-auto phone:rounded-[22px] phone:p-2 phone:shadow-[0_-8px_40px_oklch(0%_0_0/.18)] phone:animate-[sheetup_.36s_var(--ease-spring)] phone:data-ending-style:translate-y-full phone:data-ending-style:scale-100',
}

export function DropdownMenuContent({ className, side = 'bottom', align = 'start', sideOffset = 4, ...props }: ComponentProps<typeof Menu.Popup> & Pick<ComponentProps<typeof Menu.Positioner>, 'align' | 'side' | 'sideOffset'>) {
  return <Menu.Portal>
    <Menu.Backdrop className={PHONE_SHEET.backdrop} />
    <Menu.Positioner className={cn('z-50 outline-none', PHONE_SHEET.positioner)} side={side} align={align} sideOffset={sideOffset}>
      <Menu.Popup className={cn(menuPopupClass, PHONE_SHEET.popup, className)} {...props} />
    </Menu.Positioner>
  </Menu.Portal>
}

export const menuItemVariants = cva('flex cursor-default items-center rounded-md px-2 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-tint [&_svg]:shrink-0', {
  variants: {
    variant: { default: '[&_svg]:text-mute', destructive: 'text-fail [&_svg]:text-fail' },
    size: { default: 'h-[30px] gap-2 phone:h-11 phone:rounded-xl phone:px-3', tall: 'min-h-9 gap-2.5 py-1.5 phone:min-h-12 phone:rounded-xl phone:px-3' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

export function DropdownMenuItem({ className, variant, size, ...props }: ComponentProps<typeof Menu.Item> & VariantProps<typeof menuItemVariants>) {
  return <Menu.Item className={cn(menuItemVariants({ variant, size }), className)} {...props} />
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Menu.GroupLabel>) {
  return <Menu.GroupLabel className={cn('flex items-center gap-2 px-2 py-1.5 leading-[1.3]', className)} {...props} />
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Menu.Separator>) {
  return <Menu.Separator className={cn('-mx-1 my-1 h-px bg-hair', className)} {...props} />
}

export const DropdownMenuSub = Menu.SubmenuRoot
export const DropdownMenuFilter = Menu.FilterProvider
export const DropdownMenuInput = Menu.Input
export const DropdownMenuList = Menu.List
export const DropdownMenuEmpty = Menu.Empty

export function DropdownMenuSubTrigger({ className, size, ...props }: ComponentProps<typeof Menu.SubmenuTrigger> & Pick<VariantProps<typeof menuItemVariants>, 'size'>) {
  return <Menu.SubmenuTrigger className={cn(menuItemVariants({ size }), 'data-popup-open:bg-tint', className)} {...props} />
}
