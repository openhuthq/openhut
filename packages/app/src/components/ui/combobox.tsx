import type { ComponentProps } from 'react'
import { Autocomplete as AutocompletePrimitive } from '@base-ui/react/autocomplete'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import { menuItemVariants, menuPopupClass } from '@/components/ui/dropdown-menu'
import { ICONS } from '@/components/icons'
import { cn } from '@/lib/utils'

export const Combobox = ComboboxPrimitive.Root
export const ComboboxList = ComboboxPrimitive.List
export const ComboboxEmpty = ComboboxPrimitive.Empty
export const ComboboxItemIndicator = ComboboxPrimitive.ItemIndicator
export const Autocomplete = AutocompletePrimitive.Root
export const AutocompleteInput = AutocompletePrimitive.Input

export function ComboboxChips({ className, children, ...props }: ComponentProps<typeof ComboboxPrimitive.Chips>) {
  return <ComboboxPrimitive.InputGroup className="flex min-h-8 min-w-0 cursor-text flex-wrap items-center gap-1 rounded-lg border border-hair bg-card p-[3px] focus-within:border-mid data-disabled:cursor-not-allowed data-disabled:opacity-60">
    <ComboboxPrimitive.Chips className={cn('contents', className)} {...props}>{children}</ComboboxPrimitive.Chips>
  </ComboboxPrimitive.InputGroup>
}

export function ComboboxChip({ className, children, removeLabel, ...props }: ComponentProps<typeof ComboboxPrimitive.Chip> & { removeLabel: string }) {
  return <ComboboxPrimitive.Chip className={cn('inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-soft pr-0.5 pl-[7px] text-sm font-medium whitespace-nowrap outline-0 focus-within:bg-mid data-highlighted:bg-mid [&>svg]:size-3 [&>svg]:shrink-0 [&>svg]:text-mute', className)} {...props}>
    {children}
    <ComboboxPrimitive.ChipRemove className="grid size-[18px] place-items-center rounded-[4px] border-0 bg-transparent p-0 text-mute hover:bg-mid hover:text-ink [&_svg]:size-3" aria-label={removeLabel}>{ICONS.x}</ComboboxPrimitive.ChipRemove>
  </ComboboxPrimitive.Chip>
}

export function ComboboxChipsInput({ className, ...props }: ComponentProps<typeof ComboboxPrimitive.Input>) {
  return <ComboboxPrimitive.Input className={cn('h-6 w-auto min-w-24 flex-1 rounded-none border-0 bg-transparent px-1.5 py-0 text-sm text-ink focus:outline-none focus-visible:rounded-none', className)} {...props} />
}

export function ComboboxContent({ className, ...props }: ComponentProps<typeof ComboboxPrimitive.Popup>) {
  return <ComboboxPrimitive.Portal>
    <ComboboxPrimitive.Positioner className="z-50 outline-none" side="bottom" align="start" sideOffset={4}>
      <ComboboxPrimitive.Popup className={cn(menuPopupClass, 'max-h-[min(var(--available-height),320px)] w-[max(var(--anchor-width),260px)] overflow-auto', className)} {...props} />
    </ComboboxPrimitive.Positioner>
  </ComboboxPrimitive.Portal>
}

export function ComboboxItem({ className, ...props }: ComponentProps<typeof ComboboxPrimitive.Item>) {
  return <ComboboxPrimitive.Item className={cn(menuItemVariants(), 'gap-1.5 [&>svg]:size-3', className)} {...props} />
}

export function AutocompleteItem({ className, ...props }: ComponentProps<typeof AutocompletePrimitive.Item>) {
  return <AutocompletePrimitive.Item className={cn(menuItemVariants(), 'gap-1.5', className)} {...props} />
}
