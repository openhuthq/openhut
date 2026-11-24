import { Menu } from '@base-ui/react/menu'
import { HugeiconsIcon } from '@hugeicons/react'
import { Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { DropdownMenuContent, menuItemVariants } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type Option = { value: string; label: string; note?: string; disabled?: boolean }

export function MultiSelect({ label, options, value, onChange }: { label: string; options: Option[]; value: string[]; onChange: (value: string[]) => void }) {
  const picked = options.filter((option) => value.includes(option.value)).map((option) => option.label)
  return <Menu.Root>
    <Menu.Trigger aria-label={label} className="flex h-8 w-full items-center gap-2 rounded-lg border border-hair bg-card px-3 text-left text-[13px] text-ink hover:bg-hover data-popup-open:bg-hover">
      <span className="min-w-0 flex-1 truncate">{picked.join(', ') || 'None'}</span>
      <HugeiconsIcon icon={UnfoldMoreIcon} size={14} strokeWidth={1.6} className="text-mute" aria-hidden="true" />
    </Menu.Trigger>
    <DropdownMenuContent>{options.map((option) => <Menu.CheckboxItem key={option.value} closeOnClick={false} disabled={option.disabled} checked={value.includes(option.value)}
      onCheckedChange={(checked) => onChange(checked ? [...value, option.value] : value.filter((each) => each !== option.value))} className={cn(menuItemVariants(), 'text-[13px]')}>
      <span className="grid size-4 place-items-center"><Menu.CheckboxItemIndicator><HugeiconsIcon icon={Tick02Icon} size={14} strokeWidth={1.8} className="text-ink" aria-hidden="true" /></Menu.CheckboxItemIndicator></span>
      <span className="flex-1">{option.label}</span>{option.note && <span className="text-mute">{option.note}</span>}
    </Menu.CheckboxItem>)}</DropdownMenuContent>
  </Menu.Root>
}
