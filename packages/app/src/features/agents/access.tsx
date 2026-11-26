import { Menu } from '@base-ui/react/menu'
import { Tick02Icon, UnfoldMoreIcon, UserMultipleIcon } from '@hugeicons/core-free-icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger, menuItemVariants } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { I, ROW_VALUE } from '@/components/kit'
import { usePeople } from '@/features/people/api'
import { FIELD_MENU } from '@/features/models/model-picker'
import { cn } from '@/lib/utils'
import { PersonFace } from '@/components/custom/person-face'

export type Access = { shared: boolean; people: string[] }

const SHOWN = 3
const ITEM = cn(menuItemVariants(), 'h-8 gap-2 text-[13px]')

type Member = { email: string; name: string }

export function AccessPicker({ owner, value, onChange, disabled = false, title, className }: { owner: string; value: Access; onChange: (access: Access) => void; disabled?: boolean; title?: string; className: string }) {
  const team: Member[] = (usePeople().data ?? []).map((person) => ({ email: person.email, name: person.name || person.email }))
  const named = (email: string): Member => team.find((member) => member.email === email) ?? { email, name: email }
  const members = [named(owner), ...team.filter((member) => member.email !== owner)]
  const having = value.shared ? members : [named(owner), ...value.people.filter((email) => email !== owner).map(named)]
  const label = value.shared ? 'Whole team' : 'Specific people'
  const toggle = (email: string, on: boolean) => onChange({ shared: false, people: on ? [...value.people, email] : value.people.filter((each) => each !== email) })
  return <DropdownMenu>
    <DropdownMenuTrigger className={className} disabled={disabled} aria-label={`Access: ${label}`}>
      {title && <><I icon={UserMultipleIcon} size={15} className="shrink-0 text-mute" /><span className="shrink-0">{title}</span></>}
      <span className={title ? ROW_VALUE : 'flex min-w-0 flex-1 items-center gap-2'}>
        <Stack members={having} />
        <span className={cn('min-w-0 truncate', !title && 'flex-1 text-left')}>{label}</span>
        <I icon={UnfoldMoreIcon} size={12} className="shrink-0 text-mute" />
      </span>
    </DropdownMenuTrigger>
    <DropdownMenuContent className={FIELD_MENU}>
      <Menu.CheckboxItem closeOnClick={false} checked={value.shared} onCheckedChange={(shared) => onChange({ ...value, shared })} className={ITEM}>
        <I icon={UserMultipleIcon} size={14} />
        <span className="min-w-0 flex-1 truncate text-ink">Whole team</span>
        <Switch checked={value.shared} tabIndex={-1} aria-hidden className="pointer-events-none" />
      </Menu.CheckboxItem>
      <DropdownMenuSeparator />
      {members.map((member) => <Menu.CheckboxItem key={member.email} closeOnClick={false} disabled={value.shared || member.email === owner} checked={value.shared || member.email === owner || value.people.includes(member.email)}
          onCheckedChange={(on) => toggle(member.email, on)} className={ITEM}>
          <PersonFace name={member.name} email={member.email} size={20} />
          <span className="min-w-0 flex-1 truncate text-ink">{member.name}</span>
          {member.email === owner && <span className="shrink-0 text-mute">Owner</span>}
          <span className="grid w-3.5 shrink-0 place-items-center"><Menu.CheckboxItemIndicator><I icon={Tick02Icon} size={14} className="text-ink" /></Menu.CheckboxItemIndicator></span>
        </Menu.CheckboxItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}

function Stack({ members }: { members: Member[] }) {
  const more = members.length - SHOWN
  return <span className="flex shrink-0 items-center">
    {members.slice(0, SHOWN).map((member, index) => <PersonFace key={member.email} name={member.name} email={member.email} size={20} className={cn('ring-2 ring-soft', index > 0 && '-ml-1')} />)}
    {more > 0 && <span className="-ml-1 grid h-5 min-w-5 place-items-center rounded-full bg-mid px-1 text-[10px] font-medium text-ink ring-2 ring-soft">+{more}</span>}
  </span>
}
