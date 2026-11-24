import { useState } from 'react'
import { Cancel01Icon, Globe02Icon, Mail01Icon, SquareLock02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { PersonFace } from '@/components/custom/person-face'
import { Choice, I, MenuCard } from '@/components/kit'
import { nameOf } from '@/features/cloud/seen'
import { looksLikeEmail, searchPeople } from '@/features/agents/form'
import { useInvite } from '@/features/cloud/workspaces'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { SOFT_TRIGGER } from '@/features/models/model-picker'
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
  const invite = useInvite()
  const add = (email: string) => { onChange({ ...value, [field]: [...added, email] }); setQuery('') }
  const inviteOf = (email: string) => invite.mutate({ workspace: workspace.id, email, role: 'member' }, {
    onSuccess: async ({ link }) => { setQuery(''); if (!await copyText(link)) return toast(link); toast(`Invite link copied. Send it to ${email}. It works once, for 2 days.`) },
    onError: (error) => toast(error.message),
  })
  const row = 'h-8 justify-start gap-2 rounded-md px-2 text-[13px] font-normal hover:bg-hover'
  return <div className="flex w-full flex-col gap-1.5 text-left">
    <Input value={query} disabled={disabled} onChange={(event) => setQuery(event.currentTarget.value)} aria-label={value.shared ? 'Add to sidebars of' : 'Share with people'} placeholder={value.shared ? 'Add to sidebars of…' : 'Share with people…'} autoComplete="off" spellCheck={false}
      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (found.kind === 'found' && found.emails[0] && query.trim()) add(found.emails[0]) } }} className="h-9 rounded-lg text-[13px]" />
    {query.trim() && <div role="listbox" aria-label="Teammates" className="flex flex-col rounded-lg border border-hair p-1">
      {found.kind === 'found' && found.emails.map((email) => <Button key={email} type="button" variant="bare" role="option" aria-selected={false} onClick={() => add(email)} className={row}>
        <PersonFace name={nameOf(email)} email={email} size={20} /><span className="truncate">{nameOf(email)}</span><span className="truncate text-mute">{email}</span>
      </Button>)}
      {found.kind === 'none' && (looksLikeEmail(found.query)
        ? <Button type="button" variant="bare" role="option" aria-selected={false} disabled={invite.isPending} onClick={() => inviteOf(found.query)} className={row}><I icon={Mail01Icon} size={15} className="text-mute" /><span className="truncate">{invite.isPending ? 'Making the link…' : `Invite ${found.query}`}</span></Button>
        : <p className="m-0 px-2 py-1.5 text-[12.5px] text-mute">No one on your team matches. Type their email to invite them.</p>)}
    </div>}
    <p className="m-0 text-[12px]/[16px] text-mute">{value.shared ? 'They see it in their sidebar. Add no one and it shows for everyone.' : 'People you add can chat with this agent and see its chats.'}</p>
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
