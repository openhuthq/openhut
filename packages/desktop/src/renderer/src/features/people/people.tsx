import { useState, type FormEvent } from 'react'
import { Link01Icon, MoreHorizontalIcon, PlusSignIcon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView, Member } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { ErrorNote } from '@/components/error-note'
import { I, PILL } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { nameOf, useCloud } from '@/features/cloud/api'
import { NeedsCloud } from '@/features/cloud/sign-in'
import { useInvite, useSetRole, useWorkspaces, workspaceName } from '@/features/cloud/workspaces'
import { copyText } from '@/lib/clipboard'
import { open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const ROLE = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export function PeopleSettings() {
  const cloud = useCloud().data
  const { active, email } = useWorkspaces()
  if (!cloud) return null
  if (cloud.status === 'off' || !active) return <NeedsCloud title="Work on agents with your team" />
  const admin = active.role !== 'member'
  const count = active.members.length + active.invites.length
  return <section className="flex flex-col gap-2.5">
    <div className="flex items-center gap-2 px-1">
      <span className="text-[13px] font-medium">{workspaceName(active)}</span>
      <span className="ml-auto text-[12px] text-mute">{count} {count === 1 ? 'person' : 'people'}</span>
      {admin && <InviteButton workspace={active} />}
    </div>
    <div className="flex flex-col divide-y divide-hair rounded-lg border border-hair bg-card">
      {active.members.map((member) => <PersonRow key={member.email} member={member} workspace={active} you={member.email === email} admin={admin} />)}
      {active.invites.map((invite) => <div key={invite.email} className="flex items-center gap-3 px-4 py-3">
        <span className="opacity-40"><PersonFace name={nameOf(invite.email)} email={invite.email} size={40} /></span>
        <span className="grid min-w-0 flex-1 gap-px"><span className="text-[13.5px] font-medium">{nameOf(invite.email)}</span><span className="truncate text-[12px] text-mute">{invite.email} · invited as {ROLE[invite.role].toLowerCase()}</span></span>
        <span className="text-[13px] text-body">Invited</span>
        {invite.link && <Button type="button" variant="ghost" className={PILL} onClick={() => void copy(invite.link ?? '')}>Copy link</Button>}
      </div>)}
    </div>
  </section>
}

function PersonRow({ member, workspace, you, admin }: { member: Member; workspace: CloudWorkspaceView; you: boolean; admin: boolean }) {
  const setRole = useSetRole()
  const next = member.role === 'admin' ? 'member' : 'admin'
  return <div className="flex items-center gap-3 px-4 py-3">
    <PersonFace name={nameOf(member.email)} email={member.email} size={40} />
    <span className="grid min-w-0 flex-1 gap-px"><span className="flex items-center gap-2 text-[13.5px] font-medium">{nameOf(member.email)}{you && <span className="text-[12px] font-normal text-mute">You</span>}</span><span className="truncate text-[12px] text-mute">{member.role === 'owner' ? 'Started the workspace' : member.email}</span></span>
    <span className="text-[13px] text-body">{ROLE[member.role]}</span>
    {admin && member.role !== 'owner' && !you ? <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="More" title="More" disabled={setRole.isPending} />}><I icon={MoreHorizontalIcon} size={16} /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="flex w-[200px] flex-col gap-0.5 rounded-xl p-1.5 text-[13px] shadow-menu">
        <DropdownMenuItem className="h-8 px-2.5" onClick={() => setRole.mutate({ id: workspace.id, email: member.email, role: next }, { onError: toastError })}>{next === 'admin' ? 'Make admin' : 'Make member'}</DropdownMenuItem>
        <DropdownMenuItem className="h-8 px-2.5 text-fail" disabled>Remove from workspace</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu> : <span className="w-7" />}
  </div>
}

function InviteButton({ workspace }: { workspace: CloudWorkspaceView }) {
  const opened = useOpen() === 'invite'
  const invite = useInvite()
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email') ?? '')
    invite.mutate({ workspace: workspace.id, email, role }, { onSuccess: ({ link }) => void copy(link), onError: () => undefined })
  }
  return <Popover open={opened} onOpenChange={(on) => open(on ? 'invite' : undefined)}>
    <PopoverTrigger render={<Button type="button" variant="primary" className={cn(PILL, 'gap-1')} />}><I icon={PlusSignIcon} size={14} />Invite</PopoverTrigger>
    <PopoverContent className="flex w-[320px] flex-col gap-2.5 rounded-xl p-3 text-[13px]">
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <div className="flex gap-2">
          <Input name="email" type="email" required aria-label="Their email" placeholder="Their email" autoFocus className="h-8 flex-1 text-[13px]" />
          <Select value={role} onValueChange={(value) => setRole(value === 'admin' ? 'admin' : 'member')}>
            <SelectTrigger aria-label="Role" className="h-8 w-[104px] text-[13px]">{ROLE[role]}</SelectTrigger>
            <SelectContent><SelectItem value="member">Member</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="secondary" className="h-8 w-full gap-1.5" disabled={invite.isPending}><I icon={Link01Icon} size={14} />{invite.isPending ? 'Making the link…' : 'Copy invite link'}</Button>
        <ErrorNote message={invite.error?.message} />
        <span className="text-[12px] text-mute">It works once, for 48 hours, and only for this email. Send it yourself. Your agents stay private until you share them.</span>
      </form>
    </PopoverContent>
  </Popover>
}

async function copy(link: string) {
  if (await copyText(link)) toast('Invite link copied')
  else toast(link)
}
