import { useRef } from 'react'
import { MemberRole, type Invite, type Me, type Person } from '@openhut/common/team/team.ts'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ItemContent, ItemDescription, itemGroupVariants, ItemTitle, itemVariants } from '@/components/ui/item'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ConfirmButton } from '@/components/confirm-button'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { Initial } from '@/components/initial'
import { Loaded } from '@/components/loaded'
import { Locked } from '@/components/locked'
import { ButtonLabel, Page } from '@/components/page'
import { SectionHead } from '@/components/section-head'
import { useCreateInvite, useDeleteInvite, useDeletePerson, useInvites, usePeople } from '@/features/people/api'
import { shortDate } from '@/lib/format'
import { formValues } from '@/lib/form'
import { MEMBER_ROLES, ROLE_LABEL, ROLE_WITH_ARTICLE } from '@/lib/roles'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

export function PeoplePage({ me, inviting }: { me: Me; inviting: boolean }) {
  const canManage = me.user.role !== 'member'
  const people = usePeople()
  const invites = useInvites(canManage)
  const createInvite = useCreateInvite()
  return <Page title="People" actions={<InviteButton canManage={canManage} open={inviting} createInvite={createInvite} />}>
    <div className="mx-auto flex max-w-[720px] flex-col gap-8">
      <Loaded query={people}>{(loaded) => <Members people={loaded} me={me} canManage={canManage} />}</Loaded>
      <ErrorNote message={invites.error?.message} />
      {invites.data && invites.data.length > 0 && <UnusedInvites invites={invites.data} me={me} />}
    </div>
  </Page>
}

function InviteButton({ canManage, open, createInvite }: { canManage: boolean; open: boolean; createInvite: ReturnType<typeof useCreateInvite> }) {
  const popup = useRef<HTMLDivElement>(null)
  const button = <>{ICONS.plus}<ButtonLabel>Invite person</ButtonLabel></>
  if (!canManage) return <Locked reason="Only an owner or admin invites people"><Button type="button" variant="primary" disabled>{button}</Button></Locked>
  const created = createInvite.data
  return <Popover open={open} onOpenChange={(next) => navigate(next ? '/people/invite' : '/people')}>
    <PopoverTrigger className={buttonVariants({ variant: 'primary' })}>{button}</PopoverTrigger>
    <PopoverContent ref={popup} initialFocus={() => popup.current?.querySelector<HTMLElement>('input,select') ?? true}>
      {created?.link
        ? <InviteLink role={created.role} link={created.link} onAgain={createInvite.reset} />
        : <form className="contents" onSubmit={(event) => createInvite.mutate(MemberRole.parse(formValues(event)('role')))}>
          <SectionHead title="Invite a person" description="They join with a link. It works once, for 7 days." />
          <RadioGroup name="role" variant="card" aria-label="Role">
            {MEMBER_ROLES.map((role, index) => <RadioGroupItem key={role.value} value={role.value} defaultChecked={index === 0}>
              <span className="text-sm font-medium">{ROLE_LABEL[role.value]}</span>
              <span className="text-mute">{role.about}</span>
            </RadioGroupItem>)}
          </RadioGroup>
          <ErrorNote message={createInvite.error?.message} />
          <Button type="submit" variant="primary" className="justify-center" disabled={createInvite.isPending}>Create invite link</Button>
        </form>}
    </PopoverContent>
  </Popover>
}

function InviteLink({ role, link, onAgain }: { role: MemberRole; link: string; onAgain: () => void }) {
  return <section role="status" className="contents">
    <SectionHead title={`Invite link for ${ROLE_WITH_ARTICLE[role]}`} description="Send it to them. It works once, for 7 days, and isn't shown again." />
    <div className="flex gap-2">
      <Input readOnly mono className="min-w-0 flex-1 bg-canvas text-body" aria-label="Invite link" value={link} onFocus={(event) => event.target.select()} />
      <CopyButton variant="primary" size="default" text={link} label="Copy link" />
    </div>
    <Button type="button" variant="link" className="self-start text-sm" onClick={onAgain}>Create another link</Button>
  </section>
}

function Members({ people, me, canManage }: { people: Person[]; me: Me; canManage: boolean }) {
  const deletePerson = useDeletePerson()
  return <section className="flex flex-col gap-2.5">
    <SectionHead title="Members" count={people.length} description="People who can sign in to this OpenHut." />
    <ul className={itemGroupVariants({ variant: 'ring' })} aria-label="Members">{people.map((person) => <li className={itemVariants({ size: 'lg' })} key={person.id}>
      <Initial id={person.id} email={person.email} size={32} />
      <ItemContent stacked>
        <ItemTitle><span className="truncate">{person.email}</span>{person.id === me.user.id && <Badge variant="tag">You</Badge>}</ItemTitle>
        <ItemDescription>Joined {shortDate.format(new Date(person.joinedAt))}</ItemDescription>
      </ItemContent>
      <span className="w-18 shrink-0 text-body">{ROLE_LABEL[person.role]}</span>
      {canManage && <span className="flex w-7 shrink-0 justify-end">{person.role !== 'owner' && <ConfirmButton size="icon-sm" label="Remove" disabled={deletePerson.isPending} question={`Remove ${person.email}?`}
        detail="They can't sign in anymore, their tokens stop working, and their agents stop." action="Remove" onConfirm={() => deletePerson.mutate(person.id, { onError: toastError })}>{ICONS.trash}</ConfirmButton>}</span>}
    </li>)}</ul>
  </section>
}

function UnusedInvites({ invites, me }: { invites: Invite[]; me: Me }) {
  const deleteInvite = useDeleteInvite()
  return <section className="flex flex-col gap-2.5">
    <SectionHead title="Unused invite links" count={invites.length} description="Nobody has joined with these yet. Each link works once, then expires." />
    <ul className={itemGroupVariants({ variant: 'ring' })} aria-label="Unused invite links">{invites.map((invite) => <li className={itemVariants({ size: 'lg' })} key={invite.id}>
      <span className="grid size-8 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-mid text-mute" aria-hidden="true">{ICONS.link}</span>
      <ItemContent stacked>
        <ItemTitle>Link for {ROLE_WITH_ARTICLE[invite.role]}</ItemTitle>
        <ItemDescription>Created by {invite.createdBy === me.user.email ? 'you' : invite.createdBy} · expires {shortDate.format(new Date(invite.expiresAt))}</ItemDescription>
      </ItemContent>
      <Button type="button" variant="danger" size="sm" disabled={deleteInvite.isPending} onClick={() => deleteInvite.mutate(invite.id, { onError: toastError })}>Revoke</Button>
    </li>)}</ul>
  </section>
}
