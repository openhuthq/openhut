import { useState } from 'react'
import { Link01Icon, MoreHorizontalIcon, PlusSignIcon } from '@hugeicons/core-free-icons'
import type { MemberRole, Person } from '@openhut/common/team/team.ts'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Badge } from '@/components/ui/badge'
import { ErrorNote } from '@/components/error-note'
import { I, Loading, PILL, Section } from '@/components/kit'
import { PersonFace } from '@/components/custom/person-face'
import { Row, Rows } from '@/features/settings/kit'
import { useCreateInvite, useIsAdmin, useMe, usePeople, useRemovePerson, useSetRole } from '@/features/people/api'
import { copyText } from '@/lib/clipboard'
import { open, useOpen } from '@/lib/router'
import { toast, toastError, toastFailed } from '@/lib/toast'
import { cn } from '@/lib/utils'

const ROLE = { owner: 'Owner', admin: 'Admin', member: 'Member' }

export function PeopleSettings() {
  const people = usePeople()
  const admin = useIsAdmin()
  const me = useMe().data?.user.id
  if (!people.data) return people.error ? <ErrorNote message={people.error.message} /> : <Loading />
  return <Section title={people.data.length === 1 ? '1 member' : `${people.data.length} members`} action={admin ? <InviteButton /> : undefined}>
    <Rows>
      {people.data.map((person) => <div key={person.id}><PersonRow person={person} you={person.id === me} admin={admin} /></div>)}
    </Rows>
  </Section>
}

function PersonRow({ person, you, admin }: { person: Person; you: boolean; admin: boolean }) {
  const setRole = useSetRole()
  const remove = useRemovePerson()
  const [asking, setAsking] = useState(false)
  const next = person.role === 'admin' ? 'member' : 'admin'
  return <Row icon={<PersonFace name={person.name} email={person.email} size={24} />} title={<span className="flex items-center gap-2">{person.name}{you && <span className="text-[12px] text-mute">You</span>}</span>} note={person.email}>
    <Badge variant="tag">{ROLE[person.role]}</Badge>
    {admin && person.role !== 'owner' && !you ? <DropdownMenu>
      <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`More options for ${person.name}`} title="More" disabled={setRole.isPending || remove.isPending} />}><I icon={MoreHorizontalIcon} size={16} /></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="flex w-[200px] flex-col gap-0.5 rounded-xl p-1.5 text-[13px] shadow-menu">
        <DropdownMenuItem className="h-8 px-2.5" onClick={() => setRole.mutate({ id: person.id, role: next }, { onSuccess: () => toast(`${person.name} is ${next === 'admin' ? 'an admin' : 'a member'} now`), onError: toastError })}>{next === 'admin' ? 'Make admin' : 'Make member'}</DropdownMenuItem>
        <DropdownMenuItem className="h-8 px-2.5 text-fail" onClick={() => setAsking(true)}>Remove from team</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu> : <span className="w-7" />}
    <ConfirmDialog open={asking} onOpenChange={setAsking} question={`Remove ${person.name}?`} detail={`${person.name} is signed out and can’t sign in again. Their agents stay.`} action="Remove"
      onConfirm={() => remove.mutate({ id: person.id }, { onSuccess: () => toast(`${person.name} removed`), onError: toastError })} />
  </Row>
}

function InviteButton() {
  const opened = useOpen() === 'invite'
  const invite = useCreateInvite()
  const [role, setRole] = useState<MemberRole>('member')
  const make = () => invite.mutate({ role }, {
    onSuccess: async ({ link = '' }) => {
      open()
      if (!await copyText(link)) return toastFailed('Couldn’t copy the link', link)
      toast('Invite link copied', 'Send it to them yourself. It works once, for 7 days.')
    },
  })
  return <Popover open={opened} onOpenChange={(on) => open(on ? 'invite' : undefined)}>
    <PopoverTrigger render={<Button type="button" variant="primary" className={cn(PILL, 'gap-1')} />}><I icon={PlusSignIcon} size={14} />Invite</PopoverTrigger>
    <PopoverContent className="flex w-[300px] flex-col gap-2.5 rounded-xl p-3 text-[13px]">
      <ToggleGroup aria-label="Role" value={role} onPick={(picked) => setRole(picked === 'admin' ? 'admin' : 'member')} className="grid grid-cols-2">
        <ToggleGroupItem value="member" className="justify-center">Member</ToggleGroupItem>
        <ToggleGroupItem value="admin" className="justify-center">Admin</ToggleGroupItem>
      </ToggleGroup>
      <span className="text-[12px] text-body">{role === 'admin' ? 'Also invites people and changes settings.' : 'Chats with the agents the team shares, and makes their own.'}</span>
      <Button type="button" variant="primary" className="h-8 w-full gap-1.5 phone:h-11 phone:justify-center" disabled={invite.isPending} onClick={make}><I icon={Link01Icon} size={14} />{invite.isPending ? 'Making the link…' : 'Copy invite link'}</Button>
      <ErrorNote message={invite.error?.message} />
      <span className="text-[12px] text-mute">Works once, for 7 days. They pick their name and password.</span>
    </PopoverContent>
  </Popover>
}
