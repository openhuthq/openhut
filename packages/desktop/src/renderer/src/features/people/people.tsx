import { useEffect, useState, type FormEvent } from 'react'
import { FingerPrintIcon, Link01Icon, MoreHorizontalIcon, PlusSignIcon } from '@hugeicons/core-free-icons'
import type { CloudWorkspaceView, Member } from '@openhut/common/cloud/cloud.ts'
import { deviceWords, fromBase64 } from '@openhut/common/vault/vault.ts'
import { DeviceIcon, DeviceMeta } from '@/components/custom/device'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { ErrorNote } from '@/components/error-note'
import { I, PILL } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { nameOf, useCloud } from '@/features/cloud/api'
import { NeedsCloud } from '@/features/cloud/sign-in'
import { useApprove, useDeny, useInvite, useRemoveMember, useSetRole, useWorkspaces } from '@/features/cloud/workspaces'
import { ago } from '@/lib/format'
import { copyText } from '@/lib/clipboard'
import { showDone } from '@/features/cloud/unlock'
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
      <span className="text-[13px] font-medium">{active.name}</span>
      <span className="ml-auto text-[12px] text-mute">{count} {count === 1 ? 'person' : 'people'}</span>
      {admin && <InviteButton workspace={active} />}
    </div>
    <div className="flex flex-col divide-y divide-hair rounded-lg border border-hair bg-card">
      {active.members.map((member) => <div key={member.email}>
        <PersonRow member={member} workspace={active} you={member.email === email} admin={admin} />
        {active.requests.filter((each) => each.email === member.email).map((each) => <Request key={each.device} workspace={active} device={each.device} at={each.at} name={nameOf(member.email)} mine={member.email === email} admin={admin} />)}
      </div>)}
      {active.invites.map((invite) => <div key={invite.email} className="flex items-center gap-3 px-4 py-3">
        <span className="opacity-40"><PersonFace name={nameOf(invite.email)} email={invite.email} size={40} /></span>
        <span className="grid min-w-0 flex-1 gap-px"><span className="text-[13.5px] font-medium">{nameOf(invite.email)}</span><span className="truncate text-[12px] text-mute">{invite.email}</span></span>
        <span className="text-[13px] text-body">Invited</span>
        {invite.link && <Button type="button" variant="ghost" className={PILL} onClick={() => void copy(invite.link ?? '')}>Copy link</Button>}
      </div>)}
    </div>
  </section>
}

function PersonRow({ member, workspace, you, admin }: { member: Member; workspace: CloudWorkspaceView; you: boolean; admin: boolean }) {
  const setRole = useSetRole()
  const remove = useRemoveMember()
  const [removing, setRemoving] = useState(false)
  const name = nameOf(member.email)
  const next = member.role === 'admin' ? 'member' : 'admin'
  const owner = workspace.role === 'owner' && !workspace.own
  const removed = () => {
    showDone({ title: `${name} removed`, note: 'They can’t open anything new. Keys changed.' })
  }
  return <div className="flex items-center gap-3 px-4 py-3">
    <PersonFace name={name} email={member.email} size={40} />
    <span className="grid min-w-0 flex-1 gap-px"><span className="flex items-center gap-2 text-[13.5px] font-medium">{name}{you && <span className="text-[12px] font-normal text-mute">You</span>}</span><span className="truncate text-[12px] text-mute">{member.email}</span></span>
    <span className="text-[13px] text-body">{ROLE[member.role]}</span>
    {admin && member.role !== 'owner' && !you ? <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="More" title="More" disabled={setRole.isPending || remove.isPending} />}><I icon={MoreHorizontalIcon} size={16} /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="flex w-[200px] flex-col gap-0.5 rounded-xl p-1.5 text-[13px] shadow-menu">
        <DropdownMenuItem className="h-8 px-2.5" onClick={() => setRole.mutate({ id: workspace.id, email: member.email, role: next }, { onError: toastError })}>{next === 'admin' ? 'Make admin' : 'Make member'}</DropdownMenuItem>
        {owner && <DropdownMenuItem className="h-8 px-2.5" onClick={() => setRole.mutate({ id: workspace.id, email: member.email, role: 'owner' }, { onSuccess: () => toast(`${name} owns ${workspace.name} now. You’re an admin.`), onError: toastError })}>Make owner</DropdownMenuItem>}
        <DropdownMenuItem className="h-8 px-2.5 text-fail" onClick={() => setRemoving(true)}>Remove from workspace</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu> : <span className="w-7" />}
    <ConfirmDialog open={removing} onOpenChange={setRemoving} question={`Remove ${name}?`} detail={`${name} can’t open anything new, and the workspace key changes. What ${name} already saw stays on their Mac.`} action="Remove" onConfirm={() => remove.mutate({ id: workspace.id, email: member.email }, { onSuccess: removed, onError: toastError })} />
  </div>
}

function Request({ workspace, device, at, name, mine, admin }: { workspace: CloudWorkspaceView; device: string; at: string; name: string; mine: boolean; admin: boolean }) {
  const [words, setWords] = useState(['', '', '', ''])
  const [expected, setExpected] = useState<string[] | null>(null)
  const approve = useApprove()
  const deny = useDeny()
  useEffect(() => void deviceWords(fromBase64(device)).then(setExpected), [device])
  const matches = Boolean(expected) && words.map((word) => word.trim().toLowerCase()).join(' ') === expected?.join(' ')
  const set = (input: HTMLInputElement, index: number) => {
    const typed = input.value.toLowerCase().split(/\s+/)
    const parts = typed.filter(Boolean)
    setWords((all) => all.map((word, i) => i === index ? parts[0] ?? '' : i > index && i < index + parts.length ? parts[i - index] ?? word : word))
    const next = typed.length > 1 ? input.parentElement?.querySelectorAll('input')[Math.min(index + Math.max(parts.length, 1), 3)] : undefined
    if (next && next !== input) next.focus()
  }
  if (!admin && !mine) return null
  return <div className="-mt-1 flex items-center gap-3 pr-4 pb-3 pl-[68px]">
    <DeviceIcon kind="mac" />
    <span className="grid flex-1 gap-1.5">
      <span className="text-[13px] font-medium">{mine ? 'A new Mac asked to join as you' : 'New Mac wants in'}</span>
      <span className="text-[12px] text-mute"><DeviceMeta device={{ kind: 'mac', name: 'Mac', when: `${ago(at)} ago` }} /></span>
      {admin && !mine && <>
        <span className="text-[12px] text-body">Call {name} and type the 4 words on their screen</span>
        <span className="flex items-center gap-1.5">{words.map((word, index) => <Input key={index} value={word} aria-label={`Word ${index + 1}`} autoComplete="off" spellCheck={false} onChange={(event) => set(event.target, index)} className="h-7 w-[72px] px-2 text-[12.5px]" />)}</span>
      </>}
      {mine && <span className="text-[12px] text-body">If it isn’t yours, deny it. Nobody gets in without the 4 words.</span>}
    </span>
    <Button type="button" variant="ghost" className={PILL} disabled={deny.isPending} onClick={() => deny.mutate({ id: workspace.id, device }, { onSuccess: () => toast('Denied'), onError: toastError })}>{mine ? 'Not me' : 'Deny'}</Button>
    {admin && !mine && <Button type="button" variant="primary" disabled={!matches || approve.isPending} className={cn(PILL, 'gap-1.5 bg-[#12a150] text-white hover:bg-[#0f8a44]')} onClick={() => approve.mutate({ id: workspace.id, device, words }, { onSuccess: () => toast(`${name}’s Mac is in`), onError: toastError })}><I icon={FingerPrintIcon} size={14} />Approve</Button>}
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
        <span className="text-[12px] text-mute">Your agents stay private until you share them.</span>
      </form>
    </PopoverContent>
  </Popover>
}

async function copy(link: string) {
  if (await copyText(link)) toast('Invite link copied')
  else toast(link)
}
