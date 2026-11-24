import { useState } from 'react'
import { Cancel01Icon, Globe02Icon, SquareLock02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/empty-state'
import { PersonFace } from '@/components/custom/person-face'
import { Choice, I, MenuCard, PILL } from '@/components/kit'
import { nameOf } from '@/features/cloud/seen'
import { searchPeople } from '@/features/agents/form'
import { SOFT_TRIGGER } from '@/features/models/model-picker'
import { navigate } from '@/lib/router'
import { cn } from '@/lib/utils'

export type AccessValue = { shared: boolean; people: string[]; sidebars: string[] }

export function AccessPicker({ team, value, onChange, disabled, className }: { team: string; value: AccessValue; onChange: (next: AccessValue) => void; disabled?: boolean; className?: string }) {
  return <DropdownMenu>
    <DropdownMenuTrigger disabled={disabled} aria-label={`Access: ${labelOf({ team, shared: value.shared })}`} className={cn(SOFT_TRIGGER, className)}>
      <span className="flex min-w-0 items-center gap-2"><I icon={value.shared ? Globe02Icon : SquareLock02Icon} size={15} /><span className="truncate">{labelOf({ team, shared: value.shared })}</span></span><I icon={UnfoldMoreIcon} size={12} className="text-mute" />
    </DropdownMenuTrigger>
    <MenuCard title="Who can open it" align="end">
      <Choice icon={<I icon={SquareLock02Icon} size={15} />} name="Only people I pick" note="Just you until you add someone" selected={!value.shared} onClick={() => onChange({ ...value, shared: false })} />
      <Choice icon={<I icon={Globe02Icon} size={15} />} name={`Everyone on ${team}`} note="Anyone on the team can chat with it" selected={value.shared} onClick={() => onChange({ ...value, shared: true })} />
    </MenuCard>
  </DropdownMenu>
}

function labelOf({ team, shared }: { team: string; shared: boolean }) {
  return shared ? `Everyone on ${team}` : 'Only people I pick'
}

export function PeopleField({ workspace, owner, value, onChange, disabled }: { workspace: CloudWorkspaceView; owner: string; value: AccessValue; onChange: (next: AccessValue) => void; disabled?: boolean }) {
  const [query, setQuery] = useState('')
  const field = value.shared ? 'sidebars' : 'people'
  const added = value[field]
  const found = searchPeople({ members: workspace.members.map((member) => member.email), owner, added, query })
  const invite = <Button type="button" variant="secondary" className={PILL} onClick={() => navigate('/settings/people?open=invite')}>Invite</Button>
  const add = (email: string) => { onChange({ ...value, [field]: [...added, email] }); setQuery('') }
  return <div className="flex w-full flex-col gap-1.5 text-left">
    {found.kind === 'alone'
      ? <EmptyState inline line="Only you so far. Invite a teammate to share this agent." action={invite} className="px-0" />
      : <Input value={query} disabled={disabled} onChange={(event) => setQuery(event.currentTarget.value)} aria-label={value.shared ? 'Add to sidebars of' : 'Share with'} placeholder={value.shared ? 'Add to sidebars of…' : 'Share with…'} autoComplete="off" spellCheck={false}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (found.kind === 'found' && found.emails[0] && query.trim()) add(found.emails[0]) } }} className="h-9 rounded-lg text-[13px]" />}
    {found.kind === 'none' && <EmptyState inline line={`No one on your team matches “${found.query}”. Invite them by email?`} action={invite} className="px-0" />}
    {found.kind === 'found' && query.trim() && <div role="listbox" aria-label="Teammates" className="flex flex-col rounded-lg border border-hair p-1">
      {found.emails.map((email) => <Button key={email} type="button" variant="bare" role="option" aria-selected={false} onClick={() => add(email)} className="h-8 justify-start gap-2 rounded-md px-2 text-[13px] font-normal hover:bg-hover">
        <PersonFace name={nameOf(email)} email={email} size={20} /><span className="truncate">{nameOf(email)}</span><span className="truncate text-mute">{email}</span>
      </Button>)}
    </div>}
    {found.kind !== 'alone' && <p className="m-0 text-[12px]/[16px] text-mute">{value.shared ? 'They see it in their sidebar. Add no one and it shows for everyone.' : 'People you add can chat with this agent and see its chats.'}</p>}
    <ul className="m-0 flex list-none flex-col p-0">
      <Person email={owner} role="Owner" />
      {added.map((email) => <Person key={email} email={email} role={value.shared ? 'In sidebar' : 'Can chat'} onRemove={disabled ? undefined : () => onChange({ ...value, [field]: added.filter((each) => each !== email) })} />)}
    </ul>
  </div>
}

function Person({ email, role, onRemove }: { email: string; role: string; onRemove?: () => void }) {
  return <li className="flex h-8 items-center gap-2 text-[13px]">
    <PersonFace name={nameOf(email)} email={email} size={20} /><span className="min-w-0 flex-1 truncate">{nameOf(email)}</span>
    <span className="text-mute">{role}</span>
    {onRemove && <Button type="button" variant="bare" size="icon-sm" aria-label={`Remove ${email}`} title="Remove" className="text-mute hover:text-ink" onClick={onRemove}><I icon={Cancel01Icon} size={13} /></Button>}
  </li>
}
