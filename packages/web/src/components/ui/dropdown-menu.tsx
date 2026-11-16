import type { ComponentProps } from 'react'
import { Menu } from '@base-ui/react/menu'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuGroup = Menu.Group

export const menuPopupClass = 'max-w-(--available-width) min-w-[max(var(--anchor-width),224px)] origin-(--transform-origin) rounded-lg border border-hair bg-card p-1 text-sm shadow-menu outline-none [transition:opacity_.1s,scale_.1s] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0'

export function DropdownMenuContent({ className, side = 'bottom', align = 'start', sideOffset = 4, ...props }: ComponentProps<typeof Menu.Popup> & Pick<ComponentProps<typeof Menu.Positioner>, 'align' | 'side' | 'sideOffset'>) {
  return <Menu.Portal>
    <Menu.Positioner className="z-50 outline-none" side={side} align={align} sideOffset={sideOffset}>
      <Menu.Popup className={cn(menuPopupClass, className)} {...props} />
    </Menu.Positioner>
  </Menu.Portal>
}

export const menuItemVariants = cva('flex cursor-default items-center rounded-md px-2 outline-none select-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-tint [&_svg]:shrink-0', {
  variants: {
    variant: { default: '[&_svg]:text-mute', destructive: 'text-fail [&_svg]:text-fail' },
    size: { default: 'h-[30px] gap-2', tall: 'min-h-9 gap-2.5 py-1.5' },
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
