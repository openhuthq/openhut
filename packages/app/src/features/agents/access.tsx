import { useState, type ReactNode } from 'react'
import { Cancel01Icon, Globe02Icon, Mail01Icon, SquareLock02Icon, Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PersonFace, PersonFaces } from '@/components/custom/person-face'
import { I } from '@/components/kit'
import { nameOf } from '@/features/cloud/seen'
import { looksLikeEmail, previewOf, searchPeople } from '@/features/agents/form'
import { useInvite } from '@/features/cloud/workspaces'
import { copyText } from '@/lib/clipboard'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

export type AccessValue = { shared: boolean; people: string[]; sidebars: string[] }

const OPTION = 'flex items-center h-auto w-full justify-start gap-2.5 rounded-lg px-2 py-1.5 text-left font-normal hover:bg-hover'
const PERSON = 'flex items-center h-8 w-full justify-start gap-2 rounded-md px-2 text-[13px] font-normal hover:bg-hover'

export function AccessPicker({ workspace, owner, value, onChange, disabled, title = 'Who can open it', trigger, className }: { workspace: CloudWorkspaceView; owner: string; value: AccessValue; onChange: (next: AccessValue) => void; disabled?: boolean; title?: string; trigger?: (preview: ReactNode) => ReactNode; className?: string }) {
  const [query, setQuery] = useState('')
  const invite = useInvite()
  const found = searchPeople({ members: workspace.members.map((member) => member.email), owner, query })
  const set = (people: string[]) => onChange({ ...value, people })
  const toggle = (email: string) => set(value.people.includes(email) ? value.people.filter((each) => each !== email) : [...value.people, email])
  const inviteOf = (email: string) => invite.mutate({ workspace: workspace.id, email, role: 'member' }, {
    onSuccess: async ({ link }) => { setQuery(''); if (!await copyText(link)) return toast(link); toast(`Invite link copied. Send it to ${email}. It works once, for 2 days.`) },
    onError: (error) => toast(error.message),
  })

  const shown = previewOf({ owner, people: value.people })
  const label = value.shared ? `Everyone on ${workspace.name}` : shown.label
  const preview = value.shared
    ? <span className="truncate">{label}</span>
    : <span className="flex min-w-0 items-center gap-1.5"><PersonFaces people={shown.faces.map((email) => ({ email, name: nameOf(email) }))} size={18} /><span className="truncate">{shown.text}</span></span>
  return <Popover onOpenChange={(on) => { if (!on) setQuery('') }}>
    <PopoverTrigger disabled={disabled} aria-label={`Access: ${label}`} className={className}>
      {trigger ? trigger(preview) : <><span className="flex min-w-0 items-center gap-2">{value.shared && <I icon={Globe02Icon} size={15} />}{preview}</span><I icon={UnfoldMoreIcon} size={12} className="text-mute" /></>}
    </PopoverTrigger>
    <PopoverContent className="w-[320px] gap-1 p-1.5 text-[13px]">
      <div className="px-2 pt-1 pb-1.5 text-[12px] text-mute">{title}</div>
      <Option icon={Globe02Icon} name={`Everyone on ${workspace.name}`} note="Shows in everyone’s sidebar." selected={value.shared} onClick={() => onChange({ shared: true, people: value.people, sidebars: [] })} />
      <Option icon={SquareLock02Icon} name="Only people I pick" note="Just you until you add someone." selected={!value.shared} onClick={() => onChange({ ...value, shared: false, sidebars: [] })} />
      <div aria-disabled={value.shared} className={cn('mt-1 flex h-[232px] flex-col gap-1 border-t border-hair px-0.5 pt-2', value.shared && 'pointer-events-none opacity-40')}>
        <Input value={value.shared ? '' : query} disabled={value.shared} onChange={(event) => setQuery(event.currentTarget.value)} aria-label="Add people" placeholder="Add people…" autoComplete="off" spellCheck={false}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (found.kind === 'found' && found.emails[0] && query.trim()) { toggle(found.emails[0]); setQuery('') } } }} className="h-8 rounded-lg text-[13px]" />
        <div role="listbox" aria-label="Teammates" aria-multiselectable className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {(value.shared || !query.trim()) && <div className="flex h-8 items-center gap-2 px-2"><PersonFace name={nameOf(owner)} email={owner} size={20} /><span className="min-w-0 flex-1 truncate">{nameOf(owner)}</span><span className="text-mute">Owner</span></div>}
          {!value.shared && found.kind === 'found' && found.emails.map((email) => {
            const picked = value.people.includes(email)
            return <Button key={email} type="button" variant="bare" role="option" aria-selected={picked} onClick={() => toggle(email)} className={PERSON}>
              <PersonFace name={nameOf(email)} email={email} size={20} /><span className="min-w-0 flex-1 truncate text-left">{nameOf(email)} <span className="text-mute">{email}</span></span>
              <span className={cn('grid w-3.5 shrink-0 place-items-center', !picked && 'invisible', !query.trim() && 'text-mute')}><I icon={query.trim() ? Tick02Icon : Cancel01Icon} size={13} /></span>
            </Button>
          })}
          {!value.shared && found.kind === 'none' && (looksLikeEmail(found.query)
            ? <Button type="button" variant="bare" role="option" aria-selected={false} disabled={invite.isPending} onClick={() => inviteOf(found.query)} className={PERSON}><span className="grid w-5 place-items-center"><I icon={Mail01Icon} size={15} className="text-mute" /></span><span className="truncate">{invite.isPending ? 'Making the link…' : `Invite ${found.query}`}</span></Button>
            : <p className="m-0 px-2 py-1.5 text-[12.5px] text-mute">No one on your team matches. Type their email to invite them.</p>)}
        </div>
      </div>
    </PopoverContent>
  </Popover>
}

function Option({ icon, name, note, selected, onClick }: { icon: typeof Globe02Icon; name: string; note: string; selected: boolean; onClick: () => void }) {
  return <Button type="button" variant="bare" role="menuitemradio" aria-checked={selected} onClick={onClick} className={cn(OPTION, selected && 'bg-tint')}>
    <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-soft text-ink"><I icon={icon} size={15} /></span>
    <span className="grid min-w-0 flex-1 leading-tight"><span className="text-[13px] font-medium">{name}</span><span className="truncate text-[11.5px] text-mute">{note}</span></span>
    <span className={cn('grid w-3.5 shrink-0 place-items-center', !selected && 'invisible')}><I icon={Tick02Icon} size={14} /></span>
  </Button>
}
