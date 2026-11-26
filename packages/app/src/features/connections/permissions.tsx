import { Add01Icon, Delete02Icon, HelpCircleIcon, Settings02Icon, UnfoldMoreIcon, ViewIcon } from '@hugeicons/core-free-icons'
import type { Permission, ToolGroup } from '@openhut/common/connections/connection.ts'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Choice, I, MenuCard } from '@/components/kit'
import { cn } from '@/lib/utils'

export const PERMISSIONS: { value: Permission; label: string; state: string; line: string; dot: string }[] = [
  { value: 'allow', label: 'Always allow', state: 'Always allow', line: 'Goes ahead without asking', dot: 'bg-hue-green' },
  { value: 'ask', label: 'Ask first', state: 'Ask first', line: 'Waits for your OK each time', dot: 'bg-hue-amber' },
  { value: 'deny', label: 'Never', state: 'Never', line: 'Not even if asked', dot: 'bg-hue-red' },
]

const choiceOf = (permission: Permission) => PERMISSIONS.find((each) => each.value === permission) ?? PERMISSIONS[1]

export const stateOf = (permission: Permission) => choiceOf(permission).state

export const GROUPS: Record<ToolGroup, { label: string; line: string; icon: typeof ViewIcon; hue: string }> = {
  read: { label: 'Look things up', line: 'Reads without changing anything', icon: ViewIcon, hue: 'text-hue-blue' },
  create: { label: 'Add new things', line: 'Creates something new', icon: Add01Icon, hue: 'text-hue-violet' },
  update: { label: 'Change things', line: 'Edits what is already there', icon: Settings02Icon, hue: 'text-hue-amber' },
  delete: { label: 'Delete or overwrite', line: 'Can\'t be undone', icon: Delete02Icon, hue: 'text-hue-red' },
  other: { label: 'Other actions', line: 'The app doesn\'t say what these do', icon: HelpCircleIcon, hue: 'text-mute' },
}

export function GroupIcon({ group }: { group: ToolGroup }) {
  return <I icon={GROUPS[group].icon} size={16} className={GROUPS[group].hue} />
}

function Dot({ permission }: { permission: Permission }) {
  return <i className={cn('size-1.5 shrink-0 rounded-full', choiceOf(permission).dot)} />
}

export function PermissionState({ permission }: { permission: Permission }) {
  return <span className="inline-flex shrink-0 items-center gap-1.5 text-[13px] text-ink"><Dot permission={permission} />{stateOf(permission)}</span>
}

export function PermissionPicker({ value, label, choices = PERMISSIONS.map((each) => each.value), disabled, onPick }: { value: Permission | undefined; label: string; choices?: Permission[]; disabled?: boolean; onPick: (permission: Permission) => void }) {
  if (disabled) return value ? <PermissionState permission={value} /> : null
  return <DropdownMenu>
    <DropdownMenuTrigger aria-label={label} className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 text-[13px] text-ink hover:bg-hover data-popup-open:bg-hover">
      {value ? <><Dot permission={value} />{stateOf(value)}</> : <span className="text-mute">Mixed</span>}<I icon={UnfoldMoreIcon} size={12} className="text-mute" />
    </DropdownMenuTrigger>
    <MenuCard title={label} align="end">{PERMISSIONS.filter((each) => choices.includes(each.value)).map((each) => <Choice key={each.value} icon={<Dot permission={each.value} />} name={each.state} note={each.line} selected={value === each.value} onClick={() => onPick(each.value)} />)}</MenuCard>
  </DropdownMenu>
}
