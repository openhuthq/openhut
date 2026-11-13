import { MemberRole, type Invite, type Me, type Person } from '@fastmonkey/common/team/team.ts'
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
      <Loaded query={people}>{(loaded) => <PeopleTable people={loaded} canManage={canManage} />}</Loaded>
      <ErrorNote message={invites.error?.message} />
      {invites.data && invites.data.length > 0 && <PendingInvites invites={invites.data} />}
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

function PeopleTable({ people, canManage }: { people: Person[]; canManage: boolean }) {
  const deletePerson = useDeletePerson()
  return <table className={canManage ? 'ptable acts' : 'ptable'} aria-label="People">
    <thead><tr className="prow phead"><th scope="col">Name</th><th scope="col" className="pc-role">Role</th><th scope="col" className="pc-joined">Joined</th>{canManage && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
    <tbody>{people.map((person) => <tr className="prow" key={person.id}>
      <td className="pname"><Initial id={person.id} email={person.email} /><span className="ellip">{person.email}</span></td>
      <td className="pc-role">{ROLE_LABEL[person.role]}</td>
      <td className="pc-joined">{shortDate.format(new Date(person.joinedAt))}</td>
      {canManage && <td className="pact">{person.role !== 'owner' && <ConfirmButton className="btn icon sm danger" label="Remove" disabled={deletePerson.isPending} question={`Remove ${person.email}?`}
        detail="They can't sign in anymore, their tokens stop working, and their agents stop." action="Remove" onConfirm={() => deletePerson.mutate(person.id, { onError: toastError })}>{ICONS.trash}</ConfirmButton>}</td>}
    </tr>)}</tbody>
  </table>
}

function PendingInvites({ invites }: { invites: Invite[] }) {
  const deleteInvite = useDeleteInvite()
  return <section className="msec">
    <div className="shead"><h3>Pending invites <span className="count">{invites.length}</span></h3></div>
    <table className="ptable acts" aria-label="Pending invites">
      <thead><tr className="prow phead"><th scope="col">Role</th><th scope="col" className="pc-role">Created by</th><th scope="col" className="pc-joined">Expires</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
      <tbody>{invites.map((invite) => <tr className="prow" key={invite.id}>
        <td className="pname">{ROLE_LABEL[invite.role]}</td>
        <td className="pc-role ellip">{invite.createdBy}</td>
        <td className="pc-joined">{shortDate.format(new Date(invite.expiresAt))}</td>
        <td className="pact"><button type="button" className="btn icon sm" title="Revoke" aria-label="Revoke" disabled={deleteInvite.isPending} onClick={() => deleteInvite.mutate(invite.id, { onError: toastError })}>{ICONS.x}</button></td>
      </tr>)}</tbody>
    </table>
  </section>
}
