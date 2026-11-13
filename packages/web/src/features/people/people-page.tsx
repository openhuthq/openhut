import { MemberRole, type Invite, type Me, type Person } from '@jakebox/common/team/team.ts'
import { ConfirmButton } from '@/components/confirm-button'
import { CopyButton } from '@/components/copy-button'
import { ErrorNote } from '@/components/error-note'
import { Field } from '@/components/field'
import { ICONS } from '@/components/icons'
import { Initial } from '@/components/initial'
import { Loaded } from '@/components/loaded'
import { Locked } from '@/components/locked'
import { Page } from '@/components/page'
import { Popover } from '@/components/popover'
import { useCreateInvite, useDeleteInvite, useDeletePerson, useInvites, usePeople } from '@/features/people/api'
import { shortDate } from '@/lib/format'
import { formValues } from '@/lib/form'
import { ROLE_LABEL, ROLE_WITH_ARTICLE } from '@/lib/roles'
import { toastError } from '@/lib/toast'

export function PeoplePage({ me, inviting }: { me: Me; inviting: boolean }) {
  const canManage = me.user.role !== 'member'
  const people = usePeople()
  const invites = useInvites(canManage)
  const createInvite = useCreateInvite()
  const created = createInvite.data
  return <Page title="People" actions={<InviteButton canManage={canManage} open={inviting} createInvite={createInvite} />}>
    <div className="people">
      {created?.link && <div className="invite" role="status">
        <div><div className="ititle">Invite link for {ROLE_WITH_ARTICLE[created.role]}</div><div className="mute">Send it to them. It works once and for 7 days.</div></div>
        <CopyButton text={created.link} />
      </div>}
      <Loaded query={people}>{(loaded) => <PeopleTable people={loaded} canManage={canManage} />}</Loaded>
      <ErrorNote message={invites.error?.message} />
      {invites.data && invites.data.length > 0 && <PendingInvites invites={invites.data} />}
    </div>
  </Page>
}

function InviteButton({ canManage, open, createInvite }: { canManage: boolean; open: boolean; createInvite: ReturnType<typeof useCreateInvite> }) {
  const button = <>{ICONS.plus}<span className="lbl">Invite person</span></>
  if (!canManage) return <Locked reason="Only an owner or admin invites people"><button className="btn primary" disabled>{button}</button></Locked>
  return <Popover open={open} href="/people/invite" back="/people" buttonClass="btn primary" button={button}>
    <form onSubmit={(event) => createInvite.mutate(MemberRole.parse(formValues(event)('role')))}>
      <Field label="Role" error={createInvite.error?.message}>{(control) => <select {...control} name="role"><option value="member">Member</option><option value="admin">Admin</option></select>}</Field>
      <button className="btn primary" disabled={createInvite.isPending}>Create invite link</button>
    </form>
  </Popover>
}

function PeopleTable({ people, canManage }: { people: Person[]; canManage: boolean }) {
  const deletePerson = useDeletePerson()
  return <table className={canManage ? 'ptable acts' : 'ptable'} aria-label="People">
    <thead><tr className="prow phead"><th scope="col">Name</th><th scope="col" className="pc-role">Role</th><th scope="col" className="pc-joined">Joined</th>{canManage && <th scope="col"><span className="sr-only">Actions</span></th>}</tr></thead>
    <tbody>{people.map((person) => <tr className="prow" key={person.id}>
      <td className="pname"><Initial id={person.id} username={person.username} /><span className="ellip">{person.username}</span></td>
      <td className="pc-role">{ROLE_LABEL[person.role]}</td>
      <td className="pc-joined">{shortDate.format(new Date(person.joinedAt))}</td>
      {canManage && <td className="pact">{person.role !== 'owner' && <ConfirmButton className="btn ghost sm" disabled={deletePerson.isPending} question={`Remove ${person.username}?`}
        detail="They can't sign in anymore, their tokens stop working, and their agents stop." action="Remove" onConfirm={() => deletePerson.mutate(person.id, { onError: toastError })}>Remove</ConfirmButton>}</td>}
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
        <td className="pact"><button type="button" className="btn ghost sm" disabled={deleteInvite.isPending} onClick={() => deleteInvite.mutate(invite.id, { onError: toastError })}>Revoke</button></td>
      </tr>)}</tbody>
    </table>
  </section>
}
