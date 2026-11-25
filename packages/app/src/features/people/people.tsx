import { useState, type FormEvent } from 'react'
import { Link01Icon, MoreHorizontalIcon, PlusSignIcon } from '@hugeicons/core-free-icons'
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
import { shortDateTime } from '@/lib/format'
import { copyText } from '@/lib/clipboard'
import { open, useOpen } from '@/lib/router'
import { toast, toastError, toastFailed } from '@/lib/toast'
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
  const name = nameOf(invite.email)
  return <Row icon={<span className="opacity-40"><PersonFace name={name} email={invite.email} size={24} /></span>} title={name} note={[invite.email, invite.until && (Date.parse(invite.until) > Date.now() ? `link works until ${shortDateTime.format(new Date(invite.until))}` : 'link ran out')].filter(Boolean).join(' · ')}>
    {invite.link && <Button type="button" variant="ghost" className={PILL} onClick={() => void copy({ link: invite.link ?? '', email: invite.email })}>Copy link</Button>}
    {admin && <ConfirmButton className={PILL} disabled={revoke.isPending} question={`Revoke ${name}’s invite?`} detail="The link stops working. You can invite them again later." action="Revoke" onConfirm={() => revoke.mutateAsync({ id: workspace.id, email: invite.email }).then(() => toast(`${name}’s invite revoked`))}>Revoke</ConfirmButton>}
  </Row>
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
    const sent = workspace.invites.find((each) => each.email.toLowerCase() === email.toLowerCase())
    invite.mutate({ workspace: workspace.id, email, role }, { onSuccess: ({ link }) => void copy({ link, email, replaced: Boolean(sent) }).then(() => open()), onError: () => undefined })
  }
  return <Popover open={opened} onOpenChange={(on) => open(on ? 'invite' : undefined)}>
    <PopoverTrigger render={<Button type="button" variant="primary" className={cn(PILL, 'gap-1')} />}><I icon={PlusSignIcon} size={14} />Invite</PopoverTrigger>
    <PopoverContent className="flex w-[320px] flex-col gap-2.5 rounded-xl p-3 text-[13px]">
      <form onSubmit={submit} className="flex flex-col gap-2.5">
        <Input name="email" type="email" required aria-label="Their email" placeholder="Their email" autoFocus autoComplete="off" data-1p-ignore data-lpignore="true" className="h-8 w-full text-[13px] phone:h-11" onInput={(event) => setValid(event.currentTarget.validity.valid)} />
        <ToggleGroup aria-label="Role" value={role} onPick={(next) => setRole(next === 'admin' ? 'admin' : 'member')} className="grid grid-cols-2">
          <ToggleGroupItem value="member" className="justify-center">Member</ToggleGroupItem>
          <ToggleGroupItem value="admin" className="justify-center">Admin</ToggleGroupItem>
        </ToggleGroup>
        <span className="text-[12px] text-body">{role === 'admin' ? 'Also invites people and adds computers.' : 'Chats with the agents the team shares, and makes their own.'}</span>
        <Button type="submit" variant="primary" className="h-8 w-full gap-1.5 phone:h-11 phone:justify-center" disabled={!valid || invite.isPending}><I icon={Link01Icon} size={14} />{invite.isPending ? 'Making the link…' : 'Copy invite link for this email'}</Button>
        <ErrorNote message={invite.error?.message} />
        <span className="text-[12px] text-mute">Works once, for 2 days. Your agents stay private until you share them.</span>
      </form>
    </PopoverContent>
  </Popover>
}

async function copy({ link, email, replaced = false }: { link: string; email: string; replaced?: boolean }) {
  const name = nameOf(email)
  if (!await copyText(link)) return toastFailed('Couldn’t copy the link', link)
  toast(replaced ? 'New invite link copied' : 'Invite link copied', replaced ? `Send it to ${name}. The old one stops working.` : `Send it to ${name}. It works once, for 2 days.`)
}
