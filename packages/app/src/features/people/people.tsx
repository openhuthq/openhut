import { useState, type FormEvent } from 'react'
import { Mail01Icon, MoreHorizontalIcon, UserAdd01Icon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView, Member } from '@openhut/common/cloud/cloud.ts'
import { Button } from '@/components/ui/button'
import { ConfirmButton, ConfirmDialog } from '@/components/confirm-button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Badge } from '@/components/ui/badge'
import { Row, Rows } from '@/features/settings/kit'
import { ErrorNote } from '@/components/error-note'
import { I, PILL, Section } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { nameOf } from '@/features/cloud/api'
import { useInvite, useRemoveDevice, useRemoveMember, useRevokeInvite, useSetRole, useWorkspaces } from '@/features/cloud/workspaces'
import { open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const ROLE = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export function TeamPeople({ workspace }: { workspace: CloudWorkspaceView }) {
  const { email } = useWorkspaces()
  const admin = workspace.role !== 'member'
  return <>
    <Section title={workspace.members.length === 1 ? '1 member' : `${workspace.members.length} members`} action={admin ? <InviteButton workspace={workspace} /> : undefined}>
      <Rows>
        {workspace.members.map((member) => <div key={member.email}>
          <PersonRow member={member} workspace={workspace} you={member.email === email} admin={admin} />
        </div>)}
      </Rows>
    </Section>
    {workspace.invites.length > 0 && <Section title="Invited">
      <Rows>
        {workspace.invites.map((invite) => <div key={invite.email}>
          <InviteRow invite={invite} workspace={workspace} admin={admin} />
        </div>)}
      </Rows>
    </Section>}
  </>
}

function InviteRow({ invite, workspace, admin }: { invite: CloudWorkspaceView['invites'][number]; workspace: CloudWorkspaceView; admin: boolean }) {
  const revoke = useRevokeInvite()
  const resend = useInvite()
  return <Row icon={<I icon={Mail01Icon} size={18} className="w-6 text-mute" />} title={invite.email} note={`${ROLE[invite.role]} · ${sentNote(invite.until)}`}>
    {admin && <Button type="button" variant="ghost" className={PILL} disabled={resend.isPending} onClick={() => resend.mutate({ workspace: workspace.id, email: invite.email, role: invite.role }, { onSuccess: () => toast('Invite sent again', `${invite.email} gets a new email. The old link stops working.`), onError: toastError })}>{resend.isPending ? 'Sending…' : 'Resend'}</Button>}
    {admin && <ConfirmButton className={PILL} disabled={revoke.isPending} question={`Revoke ${invite.email}’s invite?`} detail="The link in the email stops working. You can invite them again later." action="Revoke" onConfirm={() => revoke.mutateAsync({ id: workspace.id, email: invite.email }).then(() => toast(`${invite.email}’s invite revoked`))}>Revoke</ConfirmButton>}
  </Row>
}

const DAY_MS = 24 * 60 * 60_000
const INVITE_DAYS = 7

export function sentNote(until: string | null, now = Date.now()): string {
  if (!until) return 'sent'
  const left = Date.parse(until) - now
  if (left <= 0) return 'ran out, resend it'
  const ago = Math.floor((INVITE_DAYS * DAY_MS - left) / DAY_MS)
  const sent = ago === 0 ? 'sent today' : ago === 1 ? 'sent yesterday' : `sent ${ago} days ago`
  const days = Math.ceil(left / DAY_MS)
  return `${sent}, works for ${days === 1 ? '1 more day' : `${days}${ago ? ' more' : ''} days`}`
}

function PersonRow({ member, workspace, you, admin }: { member: Member; workspace: CloudWorkspaceView; you: boolean; admin: boolean }) {
  const setRole = useSetRole()
  const remove = useRemoveMember()
  const removeDevice = useRemoveDevice()
  const [asking, setAsking] = useState<'remove' | string | null>(null)
  const name = nameOf(member.email)
  const next = member.role === 'admin' ? 'member' : 'admin'
  const devices = member.devices.length > 1 ? member.devices.filter((key) => key !== member.kit && workspace.names[key]) : []
  const deviceName = (key: string) => workspace.names[key] ?? 'device'
  const device = asking && asking !== 'remove' ? asking : null
  const close = (on: boolean) => { if (!on) setAsking(null) }
  return <Row icon={<PersonFace name={name} email={member.email} size={24} />} title={<span className="flex items-center gap-2">{name}{you && <span className="text-[12px] text-mute">You</span>}</span>} note={member.email}>
    <Badge variant="tag">{ROLE[member.role]}</Badge>
    {admin && member.role !== 'owner' && !you ? <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`More options for ${name}`} title="More" disabled={setRole.isPending || remove.isPending || removeDevice.isPending} />}><I icon={MoreHorizontalIcon} size={16} /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="flex w-[220px] flex-col gap-0.5 rounded-xl p-1.5 text-[13px] shadow-menu">
        <DropdownMenuItem className="h-8 px-2.5" onClick={() => setRole.mutate({ id: workspace.id, email: member.email, role: next }, { onError: toastError })}>{next === 'admin' ? 'Make admin' : 'Make member'}</DropdownMenuItem>
        {devices.map((key) => <DropdownMenuItem key={key} className="h-8 px-2.5" onClick={() => setAsking(key)}><span className="truncate">Remove {deviceName(key)}</span></DropdownMenuItem>)}
        <DropdownMenuItem className="h-8 px-2.5 text-fail" onClick={() => setAsking('remove')}>Remove from team</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu> : <span className="w-7" />}
    <ConfirmDialog open={asking === 'remove'} onOpenChange={close} question={`Remove ${name}?`} detail={`${name} can’t get anything new from OpenHut Cloud. What ${name} already saw stays on their computer.`} action="Remove" onConfirm={() => remove.mutate({ id: workspace.id, email: member.email }, { onSuccess: () => toast(`${name} removed`), onError: toastError })} />
    <ConfirmDialog open={device !== null} onOpenChange={close} question={`Remove ${device ? deviceName(device) : 'device'}?`} detail={`It can’t get anything new from ${workspace.name}.`} action="Remove" onConfirm={() => device && removeDevice.mutate({ id: workspace.id, device }, { onSuccess: () => toast(`${deviceName(device)} removed`), onError: toastError })} />
  </Row>
}

function InviteButton({ workspace }: { workspace: CloudWorkspaceView }) {
  const opened = useOpen() === 'invite'
  const invite = useInvite()
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [valid, setValid] = useState(false)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const email = String(new FormData(event.currentTarget).get('email') ?? '').trim()
    invite.mutate({ workspace: workspace.id, email, role }, { onSuccess: () => { toast('Invite sent', `We emailed ${email} a link to join ${workspace.name}.`); open() }, onError: () => undefined })
  }
  return <Popover open={opened} onOpenChange={(on) => open(on ? 'invite' : undefined)}>
    <PopoverTrigger render={<Button type="button" variant="primary" className={cn(PILL, 'gap-1')} />}><I icon={UserAdd01Icon} size={14} />Invite</PopoverTrigger>
    <PopoverContent className="flex w-[320px] flex-col gap-2.5 rounded-xl p-3 text-[13px]">
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <Input name="email" type="email" required aria-label="Their email" placeholder="Their email" autoFocus autoComplete="off" data-1p-ignore data-lpignore="true" className="h-8 w-full text-[13px] phone:h-11" onInput={(event) => setValid(event.currentTarget.validity.valid)} />
        <ToggleGroup aria-label="Role" value={role} onPick={(next) => setRole(next === 'admin' ? 'admin' : 'member')} className="grid grid-cols-2">
          <ToggleGroupItem value="member" className="justify-center">Member</ToggleGroupItem>
          <ToggleGroupItem value="admin" className="justify-center">Admin</ToggleGroupItem>
        </ToggleGroup>
        <span className="text-[12px] text-body">{role === 'admin' ? 'Also invites people and adds computers.' : 'Chats with the agents the team shares, and makes their own.'}</span>
        <Button type="submit" variant="primary" className="h-8 w-full gap-1.5 phone:h-11 phone:justify-center" disabled={!valid || invite.isPending}>{invite.isPending ? 'Sending…' : 'Send invite'}</Button>
        <ErrorNote message={invite.error?.message} />
        <span className="text-[12px] text-mute">The invite works for 7 days.</span>
      </form>
    </PopoverContent>
  </Popover>
}
