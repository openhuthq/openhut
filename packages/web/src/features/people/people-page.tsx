import { MemberRole, type Invite, type Me, type Person } from '@openhut/common/team/team.ts'
import { ConfirmButton } from '@/components/confirm-button'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { Initial } from '@/components/initial'
import { Loaded } from '@/components/loaded'
import { Locked } from '@/components/locked'
import { Page } from '@/components/page'
import { Popover } from '@/components/popover'
import { useCreateInvite, useDeleteInvite, useDeletePerson, useInvites, usePeople } from '@/features/people/api'
import { shortDate } from '@/lib/format'
import { formValues } from '@/lib/form'
import { MEMBER_ROLES, ROLE_LABEL, ROLE_WITH_ARTICLE } from '@/lib/roles'
import { toastError } from '@/lib/toast'

export function PeoplePage({ me, inviting }: { me: Me; inviting: boolean }) {
  const canManage = me.user.role !== 'member'
  const people = usePeople()
  const invites = useInvites(canManage)
  const createInvite = useCreateInvite()
  return <Page title="People" actions={<InviteButton canManage={canManage} open={inviting} createInvite={createInvite} />}>
    <div className="people">
      <Loaded query={people}>{(loaded) => <Members people={loaded} me={me} canManage={canManage} />}</Loaded>
      <ErrorNote message={invites.error?.message} />
      {invites.data && invites.data.length > 0 && <UnusedInvites invites={invites.data} me={me} />}
    </div>
  </Page>
}

function InviteButton({ canManage, open, createInvite }: { canManage: boolean; open: boolean; createInvite: ReturnType<typeof useCreateInvite> }) {
  const button = <>{ICONS.plus}<span className="lbl">Invite person</span></>
  if (!canManage) return <Locked reason="Only an owner or admin invites people"><button className="btn primary" disabled>{button}</button></Locked>
  const created = createInvite.data
  return <Popover open={open} href="/people/invite" back="/people" buttonClass="btn primary" button={button}>
    {created?.link
      ? <InviteLink role={created.role} link={created.link} onAgain={createInvite.reset} />
      : <form onSubmit={(event) => createInvite.mutate(MemberRole.parse(formValues(event)('role')))}>
        <div className="pophead"><h3>Invite a person</h3><p className="mute">They join with a link. It works once, for 7 days.</p></div>
        <fieldset className="roles">
          <legend className="sr-only">Role</legend>
          {MEMBER_ROLES.map((role, index) => <label className="rolecard" key={role.value}>
            <input type="radio" name="role" value={role.value} defaultChecked={index === 0} />
            <span className="rname">{ROLE_LABEL[role.value]}</span>
            <span className="mute">{role.about}</span>
          </label>)}
        </fieldset>
        <ErrorNote message={createInvite.error?.message} />
        <button className="btn primary" disabled={createInvite.isPending}>Create invite link</button>
      </form>}
  </Popover>
}

function InviteLink({ role, link, onAgain }: { role: MemberRole; link: string; onAgain: () => void }) {
  return <section role="status">
    <div className="pophead"><h3>Invite link for {ROLE_WITH_ARTICLE[role]}</h3><p className="mute">Send it to them. It works once, for 7 days, and isn't shown again.</p></div>
    <div className="linkrow">
      <input readOnly className="mono" aria-label="Invite link" value={link} onFocus={(event) => event.target.select()} />
      <CopyButton className="btn primary" text={link} label="Copy link" />
    </div>
    <button type="button" className="linkbtn mute" onClick={onAgain}>Create another link</button>
  </section>
}

function Members({ people, me, canManage }: { people: Person[]; me: Me; canManage: boolean }) {
  const deletePerson = useDeletePerson()
  return <section className="msec">
    <div className="pophead"><h3>Members <span className="mute">{people.length}</span></h3><p className="mute">People who can sign in to this OpenHut.</p></div>
    <ul className="lbox" aria-label="Members">{people.map((person) => <li className="lrow" key={person.id}>
      <Initial id={person.id} email={person.email} size={32} />
      <div className="t">
        <span className="nm"><span className="ellip">{person.email}</span>{person.id === me.user.id && <span className="setup-tag">You</span>}</span>
        <span className="bl">Joined {shortDate.format(new Date(person.joinedAt))}</span>
      </div>
      <span className="prole">{ROLE_LABEL[person.role]}</span>
      {canManage && <span className="pact">{person.role !== 'owner' && <ConfirmButton className="btn icon sm danger" label="Remove" disabled={deletePerson.isPending} question={`Remove ${person.email}?`}
        detail="They can't sign in anymore, their tokens stop working, and their agents stop." action="Remove" onConfirm={() => deletePerson.mutate(person.id, { onError: toastError })}>{ICONS.trash}</ConfirmButton>}</span>}
    </li>)}</ul>
  </section>
}

function UnusedInvites({ invites, me }: { invites: Invite[]; me: Me }) {
  const deleteInvite = useDeleteInvite()
  return <section className="msec">
    <div className="pophead"><h3>Unused invite links <span className="mute">{invites.length}</span></h3><p className="mute">Nobody has joined with these yet. Each link works once, then expires.</p></div>
    <ul className="lbox" aria-label="Unused invite links">{invites.map((invite) => <li className="lrow" key={invite.id}>
      <span className="invmark" aria-hidden="true">{ICONS.link}</span>
      <div className="t">
        <span className="nm">Link for {ROLE_WITH_ARTICLE[invite.role]}</span>
        <span className="bl">Created by {invite.createdBy === me.user.email ? 'you' : invite.createdBy} · expires {shortDate.format(new Date(invite.expiresAt))}</span>
      </div>
      <button type="button" className="btn sm danger" disabled={deleteInvite.isPending} onClick={() => deleteInvite.mutate(invite.id, { onError: toastError })}>Revoke</button>
    </li>)}</ul>
  </section>
}
