import type { Deleted } from '@openhut/common/api.ts'
import type { CreatePerson, CreateSession, Invite, InviteLink, Me, MemberRole, Person, Session, Setup } from '@openhut/common/team/team.ts'
import type { Selectable } from 'kysely'
import type { Database } from '../platform/db-schema.ts'
import { db, isUniqueViolation } from '../platform/db.ts'
import { config } from '../platform/config.ts'
import { HttpError } from '../platform/http-error.ts'
import { checkPassword, hashPassword, newId, newToken, sameSecret, sha } from '../platform/secrets.ts'
import { publicUrl, settings } from '../platform/settings.ts'
import { record } from '../platform/events.ts'
import { deleted } from '../platform/responses.ts'
import { agentService } from '../agents/agent-service.ts'
import { isAdmin, SESSION_DAYS, type Caller } from './identity.ts'

const INVITE_DAYS = 7

export const teamService = {
  async setup(): Promise<Setup> {
    return { object: 'setup', open: !(await db.selectFrom('person').select('id').limit(1).executeTakeFirst()) }
  },

  async createPerson(input: CreatePerson & { origin: string }): Promise<{ person: Person; token: string }> {
    const person = 'setupCode' in input ? await createOwner(input) : await acceptInvite(input)
    record({ action: 'person.joined', actor: person, target: { type: 'person', id: person.id, role: person.role } })
    return { person, token: (await openSession(person)).token }
  },

  async createSession({ email, password }: CreateSession): Promise<{ session: Session; token: string }> {
    const row = await db.selectFrom('person').selectAll().where('email', '=', email).where('removed_at', 'is', null).executeTakeFirst()
    if (!(await checkPassword({ password, stored: row?.pass })) || !row) throw new HttpError(401, 'That email and password don\'t match. Try again.')
    return openSession(personOf(row))
  },

  async endSession({ token }: { token: string | undefined }): Promise<void> {
    if (token) await db.deleteFrom('session').where('hash', '=', sha(token)).execute()
  },

  async me({ personId }: { personId: string }): Promise<Me> {
    const person = await db.selectFrom('person').selectAll().where('id', '=', personId).executeTakeFirstOrThrow()
    return { object: 'me', user: personOf(person), publicUrl: publicUrl(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
  },

  async createInvite({ actor, role }: { actor: Caller; role: MemberRole }): Promise<Invite> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can invite people.')
    const token = newToken('fmi')
    const row = await db.insertInto('invite')
      .values({ id: newId('inv'), hash: sha(token), role, created_by: actor.id, expires_at: new Date(Date.now() + INVITE_DAYS * 864e5), used_at: null })
      .returningAll().executeTakeFirstOrThrow()
    record({ action: 'invite.created', actor, target: { type: 'invite', id: row.id, role } })
    return { ...inviteOf({ ...row, created_by_name: actor.email }), link: `${publicUrl()}/invite/${token}` }
  },

  async inviteLink({ token }: { token: string }): Promise<InviteLink> {
    const invite = await db.selectFrom('invite').select(['id', 'role', 'expires_at']).where('hash', '=', sha(token)).where('used_at', 'is', null)
      .where('expires_at', '>', new Date()).executeTakeFirst()
    if (!invite) throw new HttpError(410, 'This invite link was already used or has expired. Ask for a new one.')
    return { id: invite.id, object: 'invite_link', role: invite.role, expiresAt: new Date(invite.expires_at).toISOString() }
  },

  async listInvites({ actor }: { actor: Caller }): Promise<Invite[]> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can see pending invites.')
    const rows = await db.selectFrom('invite as i').innerJoin('person as p', 'p.id', 'i.created_by').selectAll('i').select('p.email as created_by_name')
      .where('i.used_at', 'is', null).where('i.expires_at', '>', new Date()).orderBy('i.expires_at').execute()
    return rows.map(inviteOf)
  },

  async deleteInvite({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'invite'>> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can revoke invites.')
    const result = await db.deleteFrom('invite').where('id', '=', id).where('used_at', 'is', null).executeTakeFirst()
    if (!result.numDeletedRows) throw new HttpError(404, 'That invite was already used or revoked.')
    record({ action: 'invite.revoked', actor, target: { type: 'invite', id } })
    return deleted({ id, object: 'invite' })
  },

  async listPeople(): Promise<Person[]> {
    return (await db.selectFrom('person').selectAll().where('removed_at', 'is', null).orderBy('created_at').execute()).map(personOf)
  },

  async deletePerson({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'person'>> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can remove people.')
    const person = await db.selectFrom('person').select(['id', 'role']).where('id', '=', id).where('removed_at', 'is', null).executeTakeFirst()
    if (!person) throw new HttpError(404, 'That person isn\'t on the team.')
    if (person.role === 'owner') throw new HttpError(403, 'The team always keeps its owner. Remove someone else.')
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('person').set({ removed_at: new Date() }).where('id', '=', id).execute()
      await trx.deleteFrom('session').where('person_id', '=', id).execute()
      await trx.deleteFrom('oauth_grant').where('person_id', '=', id).execute()
      await trx.deleteFrom('invite').where('created_by', '=', id).where('used_at', 'is', null).execute()
    })
    await agentService.stopOwnedBy({ ownerId: id })
    record({ action: 'person.removed', actor, target: { type: 'person', id } })
    return deleted({ id, object: 'person' })
  },
}

async function openSession(person: Person): Promise<{ session: Session; token: string }> {
  const token = newToken('fms')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5)
  await db.insertInto('session').values({ hash: sha(token), person_id: person.id, expires_at: expiresAt }).execute()
  return { session: { id: sha(token).slice(0, 16), object: 'session', person, expiresAt: expiresAt.toISOString() }, token }
}

async function createOwner({ setupCode, email, password, origin }: { setupCode: string; email: string; password: string; origin: string }): Promise<Person> {
  if (!config.setupCode || !sameSecret({ given: setupCode, expected: config.setupCode })) {
    throw new HttpError(403, 'That setup code is wrong. Use the link the installer printed; the code is also in /etc/openhut/env.', { param: 'setupCode' })
  }
  const pass = await hashPassword(password)
  const owner = await db.transaction().execute(async (trx) => {
    if (await trx.selectFrom('person').select('id').limit(1).executeTakeFirst()) throw new HttpError(403, 'This server already has an owner. Ask them for an invite.')
    return trx.insertInto('person').values({ id: newId('usr'), email, pass, role: 'owner', removed_at: null }).returningAll().executeTakeFirstOrThrow()
  }).catch((err: unknown) => { throw isUniqueViolation(err) ? new HttpError(403, 'This server already has an owner. Ask them for an invite.') : err })
  if (!settings.storedPublicUrl()) await settings.setPublicUrl(origin)
  return personOf(owner)
}

async function acceptInvite({ inviteToken, email, password }: { inviteToken: string; email: string; password: string }): Promise<Person> {
  const pass = await hashPassword(password)
  return db.transaction().execute(async (trx) => {
    const invite = await trx.updateTable('invite').set({ used_at: new Date() }).where('hash', '=', sha(inviteToken)).where('used_at', 'is', null)
      .where('expires_at', '>', new Date()).returning('role').executeTakeFirst()
    if (!invite) throw new HttpError(410, 'This invite link was already used or has expired. Ask for a new one.')
    const person = await trx.insertInto('person').values({ id: newId('usr'), email, pass, role: invite.role, removed_at: null }).returningAll().executeTakeFirstOrThrow()
      .catch((err: unknown) => { throw isUniqueViolation(err) ? new HttpError(409, 'That email already has an account. Use another one.', { param: 'email' }) : err })
    return personOf(person)
  })
}

function personOf(person: Pick<Selectable<Database['person']>, 'id' | 'email' | 'role' | 'created_at'>): Person {
  return { id: person.id, object: 'person', email: person.email, role: person.role, joinedAt: new Date(person.created_at).toISOString() }
}

function inviteOf(row: Pick<Selectable<Database['invite']>, 'id' | 'role' | 'expires_at'> & { created_by_name: string }): Invite {
  return { id: row.id, object: 'invite', role: row.role, createdBy: row.created_by_name, expiresAt: new Date(row.expires_at).toISOString() }
}
