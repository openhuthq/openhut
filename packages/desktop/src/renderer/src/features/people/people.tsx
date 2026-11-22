import { useEffect, useState, type FormEvent } from 'react'
import { FingerPrintIcon, Key01Icon, Link01Icon, MoreHorizontalIcon, PlusSignIcon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView, DeviceRequest, Member } from '@openhut/common/cloud/cloud.ts'
import { deviceWords, fromBase64 } from '@openhut/common/vault/vault.ts'
import { DeviceIcon, DeviceMeta } from '@/components/custom/device'
import { Button } from '@/components/ui/button'
import { ConfirmButton, ConfirmDialog } from '@/components/confirm-button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { ErrorNote } from '@/components/error-note'
import { I, PILL } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { nameOf, useCloud } from '@/features/cloud/api'
import { SignInOnTeam } from '@/features/cloud/sign-in'
import { Row, Rows } from '@/features/settings/kit'
import { CloudSetup } from '@/features/cloud/setup'
import { peopleNote, useApprove, useDeny, useInvite, useRemoveDevice, useRemoveMember, useRevokeInvite, useSetRole, useWorkspaces } from '@/features/cloud/workspaces'
import { ago } from '@/lib/format'
import { copyText } from '@/lib/clipboard'
import { isPhone, useConfirmed } from '@/lib/native'
import { notify } from '@/components/custom/toast'
import { open, useOpen } from '@/lib/router'
import { toast, toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const ROLE = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export function PeopleSettings() {
  const cloud = useCloud().data
  const { active, email } = useWorkspaces()
  const opened = useOpen()
  if (!cloud) return null
  const enabling = opened === 'enable' && <CloudSetup />
  if (cloud.status === 'off' || !active) return <>{enabling}<SignInOnTeam what="who’s in it" /></>
  const admin = active.role !== 'member'
  return <>{enabling}{!cloud.kit && <Rows><Row icon={<I icon={Key01Icon} size={20} className="text-hue-amber" />} title="Recovery kit" note="Not saved"><Button type="button" variant="primary" className={PILL} onClick={() => open('enable')}>Save kit</Button></Row></Rows>}<section className="flex flex-col gap-2.5">
    <div className="flex items-center gap-2 px-1">
      <span className="text-[13px] font-medium">{active.name}</span>
      <span className="ml-auto text-[12px] text-mute">{peopleNote(active)}</span>
      {admin && <InviteButton workspace={active} />}
    </div>
    <div className="flex flex-col divide-y divide-hair rounded-lg border border-hair bg-card">
      {active.members.map((member) => <div key={member.email}>
        <PersonRow member={member} workspace={active} you={member.email === email} admin={admin} />
        {active.requests.filter((each) => each.email === member.email).map((each) => <Request key={each.device} workspace={active} request={each} name={nameOf(member.email)} mine={member.email === email} admin={admin} />)}
      </div>)}
      {active.invites.map((invite) => <InviteRow key={invite.email} invite={invite} workspace={active} admin={admin} />)}
    </div>
  </section></>
}

function InviteRow({ invite, workspace, admin }: { invite: CloudWorkspaceView['invites'][number]; workspace: CloudWorkspaceView; admin: boolean }) {
  const revoke = useRevokeInvite()
  const name = nameOf(invite.email)
  return <div className="flex items-center gap-3 px-4 py-3">
    <span className="opacity-40"><PersonFace name={name} email={invite.email} size={40} /></span>
    <span className="grid min-w-0 flex-1 gap-px"><span className="text-[13.5px] font-medium">{name}</span><span className="truncate text-[12px] text-mute">{invite.email}</span></span>
    <span className="text-[13px] text-body">Invited</span>
    {invite.link && <Button type="button" variant="ghost" className={PILL} onClick={() => void copy(invite.link ?? '')}>Copy link</Button>}
    {admin && <ConfirmButton variant="secondary" className={cn(PILL, 'text-fail')} disabled={revoke.isPending} question={`Revoke ${name}’s invite?`} detail="The link stops working. You can invite them again later." action="Revoke" onConfirm={() => revoke.mutateAsync({ id: workspace.id, email: invite.email }).then(() => toast(`${name}’s invite revoked`))}>Revoke</ConfirmButton>}
  </div>
}

function PersonRow({ member, workspace, you, admin }: { member: Member; workspace: CloudWorkspaceView; you: boolean; admin: boolean }) {
  const setRole = useSetRole()
  const remove = useRemoveMember()
  const removeDevice = useRemoveDevice()
  const [asking, setAsking] = useState<'remove' | 'owner' | string | null>(null)
  const name = nameOf(member.email)
  const next = member.role === 'admin' ? 'member' : 'admin'
  const owner = workspace.role === 'owner' && !workspace.own
  const devices = member.devices.length > 1 ? member.devices.filter((key) => key !== member.kit && workspace.names[key]) : []
  const deviceName = (key: string) => workspace.names[key] ?? 'device'
  const device = asking && asking !== 'remove' && asking !== 'owner' ? asking : null
  const close = (on: boolean) => { if (!on) setAsking(null) }
  return <div className="flex items-center gap-3 px-4 py-3">
    <PersonFace name={name} email={member.email} size={40} />
    <span className="grid min-w-0 flex-1 gap-px"><span className="flex items-center gap-2 text-[13.5px] font-medium">{name}{you && <span className="text-[12px] font-normal text-mute">You</span>}</span><span className="truncate text-[12px] text-mute">{member.email}</span></span>
    <span className="text-[13px] text-body">{ROLE[member.role]}</span>
    {admin && member.role !== 'owner' && !you ? <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`More options for ${name}`} title="More" disabled={setRole.isPending || remove.isPending || removeDevice.isPending} />}><I icon={MoreHorizontalIcon} size={16} /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="flex w-[220px] flex-col gap-0.5 rounded-xl p-1.5 text-[13px] shadow-menu">
        <DropdownMenuItem className="h-8 px-2.5" onClick={() => setRole.mutate({ id: workspace.id, email: member.email, role: next }, { onError: toastError })}>{next === 'admin' ? 'Make admin' : 'Make member'}</DropdownMenuItem>
        {owner && <DropdownMenuItem className="h-8 px-2.5" onClick={() => setAsking('owner')}>Make owner</DropdownMenuItem>}
        {devices.map((key) => <DropdownMenuItem key={key} className="h-8 px-2.5" onClick={() => setAsking(key)}><span className="truncate">Remove {deviceName(key)}</span></DropdownMenuItem>)}
        <DropdownMenuItem className="h-8 px-2.5 text-fail" onClick={() => setAsking('remove')}>Remove from workspace</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu> : <span className="w-7" />}
    <ConfirmDialog open={asking === 'remove'} onOpenChange={close} question={`Remove ${name}?`} detail={`${name} can’t get anything new from OpenHut Cloud. What ${name} already saw stays on their computer.`} action="Remove" onConfirm={() => remove.mutate({ id: workspace.id, email: member.email }, { onSuccess: () => notify({ title: `${name} removed`, note: 'They can’t get anything new from OpenHut Cloud.' }), onError: toastError })} />
    <ConfirmDialog open={asking === 'owner'} onOpenChange={close} question={`Make ${name} the owner?`} detail={`You become an admin. Only ${name} can change this.`} action="Make owner" onConfirm={() => setRole.mutate({ id: workspace.id, email: member.email, role: 'owner' }, { onSuccess: () => toast(`${name} owns ${workspace.name} now. You’re an admin.`), onError: toastError })} />
    <ConfirmDialog open={device !== null} onOpenChange={close} question={`Remove ${device ? deviceName(device) : 'device'}?`} detail={`It can’t get anything new from ${workspace.name}.`} action="Remove" onConfirm={() => device && removeDevice.mutate({ id: workspace.id, device }, { onSuccess: () => toast(`${deviceName(device)} removed`), onError: toastError })} />
  </div>
}

function Request({ workspace, request, name, mine, admin }: { workspace: CloudWorkspaceView; request: DeviceRequest; name: string; mine: boolean; admin: boolean }) {
  const { device, at, nonce, reveal } = request
  const ready = Boolean(nonce && reveal)
  const [words, setWords] = useState(['', '', '', ''])
  const [expected, setExpected] = useState<string[] | null>(null)
  const approve = useApprove()
  const deny = useDeny()
  useEffect(() => {
    if (nonce && reveal) void deviceWords({ device: fromBase64(device), nonce: fromBase64(nonce.nonce), reveal: fromBase64(reveal) }).then(setExpected)
  }, [device, nonce, reveal])
  const { asking, confirm } = useConfirmed()
  const matches = Boolean(expected) && words.map((word) => word.trim().toLowerCase()).join(' ') === expected?.join(' ')
  useEffect(() => { if (matches && isPhone() && document.activeElement instanceof HTMLInputElement) document.activeElement.blur() }, [matches])
  const set = (input: HTMLInputElement, index: number) => {
    const typed = input.value.toLowerCase().split(/\s+/)
    const parts = typed.filter(Boolean)
    if (!parts.length) parts.push('')
    setWords((all) => all.map((word, i) => i < index || i >= index + parts.length ? word : parts[i - index]))
    const next = typed.length > 1 ? input.parentElement?.querySelectorAll('input')[Math.min(index + parts.length, 3)] : undefined
    if (next && next !== input) next.focus()
  }
  if (!admin && !mine) return null
  const title = request.name ?? 'computer'
  return <div className="-mt-1 flex flex-wrap items-center gap-3 pr-4 pb-3 pl-[68px] phone:items-start phone:pl-4">
    <DeviceIcon kind="mac" />
    <span className="grid min-w-0 flex-1 gap-1.5">
      <span className="text-[13px] font-medium">{mine ? `${title} asked to join as you` : `New ${title} wants in`}</span>
      <span className="text-[12px] text-mute"><DeviceMeta device={{ kind: 'mac', name: title, os: request.os ?? undefined, when: `${ago(at)} ago` }} /></span>
      {admin && !mine && <>
        <span className="text-[12px] text-body">{ready ? `Call ${name} and type the 4 words on their screen` : 'The words show once their computer is ready.'}</span>
        <span className="flex flex-wrap items-center gap-1.5">{words.map((word, index) => <Input key={index} value={word} disabled={!ready} aria-label={`Word ${index + 1}`} autoComplete="off" autoCapitalize="none" spellCheck={false} onChange={(event) => set(event.target, index)} className="h-7 w-[72px] px-2 text-[12.5px] phone:h-11 phone:w-[calc(50%-3px)] phone:px-3" />)}</span>
      </>}
      {mine && <span className="text-[12px] text-body">If it isn’t yours, deny it. Nobody gets in without the 4 words.</span>}
    </span>
    <span className="flex gap-2 phone:w-full phone:justify-end phone:*:h-11 phone:*:flex-1 phone:*:justify-center phone:*:rounded-xl">
      <Button type="button" variant="ghost" className={PILL} disabled={deny.isPending} onClick={() => deny.mutate({ id: workspace.id, device }, { onSuccess: () => toast('Denied'), onError: toastError })}>{mine ? 'Not me' : 'Deny'}</Button>
      {admin && !mine && <Button type="button" variant="primary" disabled={!matches || asking || approve.isPending} className={cn(PILL, 'gap-1.5 bg-[#12a150] text-white hover:bg-[#0f8a44]')} onClick={() => void confirm(`Approve ${name}’s new ${title}`).then((ok) => { if (ok) approve.mutate({ id: workspace.id, device, words }, { onSuccess: () => toast(`${name}’s new ${title} is in`), onError: toastError }) })}><I icon={FingerPrintIcon} size={14} />Approve</Button>}
    </span>
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
          <Input name="email" type="email" required aria-label="Their email" placeholder="Their email" autoFocus className="h-8 flex-1 text-[13px] phone:h-11" />
          <Select value={role} onValueChange={(value) => setRole(value === 'admin' ? 'admin' : 'member')}>
            <SelectTrigger aria-label="Role" className="h-8 w-[104px] text-[13px] phone:h-11">{ROLE[role]}</SelectTrigger>
            <SelectContent><SelectItem value="member">Member</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
          </Select>
        </div>
        <Button type="submit" variant="secondary" className="h-8 w-full gap-1.5 phone:h-11 phone:justify-center" disabled={invite.isPending}><I icon={Link01Icon} size={14} />{invite.isPending ? 'Making the link…' : 'Copy invite link'}</Button>
        <ErrorNote message={invite.error?.message} />
        <span className="text-[12px] text-mute">Your agents stay private until you share them.</span>
      </form>
    </PopoverContent>
  </Popover>
}

async function copy(link: string) {
  if (await copyText(link)) toast('Invite link copied')
  else toast(link)
}
