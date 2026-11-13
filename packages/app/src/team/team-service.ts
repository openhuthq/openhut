import type { CreatePerson, Invite, InviteLink, Me, MemberRole, Person, Setup, TeamRole } from '@jakebox/common/team/team.ts'
import { db } from '../platform/db.ts'
import { config } from '../platform/config.ts'
import { HttpError } from '../platform/http-error.ts'
import { checkPassword, hashPassword, newId, newToken, sameSecret, sha } from '../platform/secrets.ts'
import { publicUrl, settings } from '../platform/settings.ts'
import { agentService } from '../agents/agent-service.ts'
import { isAdmin, SESSION_DAYS, type Caller } from './identity.ts'

const INVITE_DAYS = 7
const UNIQUE_VIOLATION = '23505'

export const teamService = {
  async setup(): Promise<Setup> {
    return { object: 'setup', open: !(await db.selectFrom('person').select('id').limit(1).executeTakeFirst()) }
  },

  async createPerson({ body, origin }: { body: CreatePerson; origin: string }): Promise<Person> {
    if ('setupCode' in body) return createOwner({ ...body, origin })
    return acceptInvite(body)
  },

  async signIn({ username, password }: { username: string; password: string }): Promise<Person> {
    const person = await db.selectFrom('person').selectAll().where('username', '=', username).where('removed_at', 'is', null).executeTakeFirst()
    if (!(await checkPassword({ password, stored: person?.pass })) || !person) throw new HttpError(401, 'That username and password don\'t match. Try again.')
    return personOf(person)
  },

  async createSession({ personId }: { personId: string }): Promise<string> {
    const token = newToken('jbs')
    await db.insertInto('session').values({ hash: sha(token), person_id: personId, expires_at: new Date(Date.now() + SESSION_DAYS * 864e5) }).execute()
    return token
  },

  async endSession({ token }: { token: string | undefined }): Promise<void> {
    if (token) await db.deleteFrom('session').where('hash', '=', sha(token)).execute()
  },

  async me({ personId, url }: { personId: string; url: string }): Promise<Me> {
    const person = await db.selectFrom('person').selectAll().where('id', '=', personId).executeTakeFirstOrThrow()
    return { object: 'me', user: personOf(person), publicUrl: url }
  },

  async createInvite({ actor, role }: { actor: Caller; role: MemberRole }): Promise<Invite> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can invite people.')
    const token = newToken('jbi')
    const row = await db.insertInto('invite')
      .values({ id: newId('inv'), hash: sha(token), role, created_by: actor.id, expires_at: new Date(Date.now() + INVITE_DAYS * 864e5), used_at: null })
      .returningAll().executeTakeFirstOrThrow()
    return { ...inviteOf({ ...row, created_by_name: actor.username }), link: `${publicUrl()}/invite/${token}` }
  },

  async inviteLink({ token }: { token: string }): Promise<InviteLink> {
    const invite = await db.selectFrom('invite').select(['role', 'expires_at']).where('hash', '=', sha(token)).where('used_at', 'is', null)
      .where('expires_at', '>', new Date()).executeTakeFirst()
    if (!invite) throw new HttpError(410, 'This invite link was already used or has expired. Ask for a new one.')
    return { object: 'invite_link', role: invite.role, expiresAt: new Date(invite.expires_at).toISOString() }
  },

  async listInvites({ actor }: { actor: Caller }): Promise<Invite[]> {
    if (!isAdmin(actor)) return []
    const rows = await db.selectFrom('invite as i').innerJoin('person as p', 'p.id', 'i.created_by').selectAll('i').select('p.username as created_by_name')
      .where('i.used_at', 'is', null).where('i.expires_at', '>', new Date()).orderBy('i.expires_at').execute()
    return rows.map(inviteOf)
  },

  async deleteInvite({ actor, id }: { actor: Caller; id: string }): Promise<void> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can revoke invites.')
    const result = await db.deleteFrom('invite').where('id', '=', id).where('used_at', 'is', null).executeTakeFirst()
    if (!result.numDeletedRows) throw new HttpError(404, 'That invite was already used or revoked.')
  },

  async listPeople(): Promise<Person[]> {
    return (await db.selectFrom('person').selectAll().where('removed_at', 'is', null).orderBy('created_at').execute()).map(personOf)
  },

  async deletePerson({ actor, id }: { actor: Caller; id: string }): Promise<void> {
    if (!isAdmin(actor)) throw new HttpError(403, 'Only an owner or admin can remove people.')
    const person = await db.selectFrom('person').select(['id', 'role']).where('id', '=', id).where('removed_at', 'is', null).executeTakeFirst()
    if (!person) throw new HttpError(404, 'That person isn\'t on the team.')
    if (person.role === 'owner') throw new HttpError(403, 'The owner can\'t be removed.')
    await db.transaction().execute(async (trx) => {
      await trx.updateTable('person').set({ removed_at: new Date() }).where('id', '=', id).execute()
      await trx.deleteFrom('session').where('person_id', '=', id).execute()
      await trx.deleteFrom('oauth_grant').where('person_id', '=', id).execute()
      await trx.deleteFrom('invite').where('created_by', '=', id).where('used_at', 'is', null).execute()
    })
    await agentService.stopOwnedBy({ ownerId: id })
  },
}

async function createOwner({ setupCode, username, password, origin }: { setupCode: string; username: string; password: string; origin: string }): Promise<Person> {
  if (!config.setupCode || !sameSecret({ given: setupCode, expected: config.setupCode })) {
    throw new HttpError(403, 'That setup code is wrong. Use the link the installer printed; the code is also in /etc/jakebox/env.', { param: 'setupCode' })
  }
  const pass = await hashPassword(password)
  const owner = await db.transaction().execute(async (trx) => {
    if (await trx.selectFrom('person').select('id').limit(1).executeTakeFirst()) throw new HttpError(403, 'JakeBox already has an owner. Ask them for an invite.')
    return trx.insertInto('person').values({ id: newId('usr'), username, pass, role: 'owner', removed_at: null }).returningAll().executeTakeFirstOrThrow()
  }).catch((err: unknown) => {
    if (isUniqueViolation(err)) throw new HttpError(403, 'JakeBox already has an owner. Ask them for an invite.')
    throw err
  })
  if (!settings.publicUrl()) await settings.setPublicUrl(origin)
  return personOf(owner)
}

async function acceptInvite({ inviteToken, username, password }: { inviteToken: string; username: string; password: string }): Promise<Person> {
  const pass = await hashPassword(password)
  return db.transaction().execute(async (trx) => {
    const invite = await trx.updateTable('invite').set({ used_at: new Date() }).where('hash', '=', sha(inviteToken)).where('used_at', 'is', null)
      .where('expires_at', '>', new Date()).returning('role').executeTakeFirst()
    if (!invite) throw new HttpError(410, 'This invite link was already used or has expired. Ask for a new one.')
    const person = await trx.insertInto('person').values({ id: newId('usr'), username, pass, role: invite.role, removed_at: null }).returningAll().executeTakeFirstOrThrow()
      .catch((err: unknown) => {
        if (isUniqueViolation(err)) throw new HttpError(409, 'That username is taken. Pick another one.', { param: 'username' })
        throw err
      })
    return personOf(person)
  })
}

const isUniqueViolation = (err: unknown): boolean => typeof err === 'object' && err !== null && 'code' in err && err.code === UNIQUE_VIOLATION

function personOf(person: { id: string; username: string; role: TeamRole; created_at: Date }): Person {
  return { id: person.id, object: 'person', username: person.username, role: person.role, joinedAt: new Date(person.created_at).toISOString() }
}

function inviteOf(row: { id: string; role: MemberRole; expires_at: Date; created_by_name: string }): Invite {
  return { id: row.id, object: 'invite', role: row.role, createdBy: row.created_by_name, expiresAt: new Date(row.expires_at).toISOString() }
}
