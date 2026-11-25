import { randomBytes } from 'node:crypto'
import type { Selectable } from 'kysely'
import type { Deleted } from '@openhut/common/api.ts'
import type { CreatePerson, Invite, Me, MemberRole, Person, Session, Setup } from '@openhut/common/team/team.ts'
import { config } from '../platform/config.ts'
import { db, isUniqueViolation } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { deleted } from '../platform/responses.ts'
import { checkPassword, hashPassword, newId, newToken, sha } from '../platform/secrets.ts'
import { settings } from '../platform/settings.ts'
import { google } from '../integrations/google/google.ts'
import { smtp } from '../integrations/smtp/smtp.ts'
import { requireAdmin, SESSION_DAYS, type Caller } from './identity.ts'

const DAY_MS = 86_400_000
const INVITE_DAYS = 7
const RESET_MS = 60 * 60_000
const SIGN_IN_MS = 10 * 60_000
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 28
const WRONG_CODE = 'That setup code is wrong or was already used. Get a fresh one on the server: docker exec openhut openhut setup-code'
const HAS_OWNER = 'This install already has an owner. Sign in, or ask the owner for an invite.'
const USED_INVITE = 'This invite link was already used or has expired. Ask for a new one.'
const googleSignIns = new Map<string, { verifier: string; expires: number }>()

export const teamService = {
  async setup(): Promise<Setup> {
    return { object: 'setup', open: !(await claimedOwner()), googleSignIn: settings.googleSignIn(), passwordReset: !!settings.smtp() }
  },

  async mintSetupCode(): Promise<{ object: 'setup_code'; code: string; url: string }> {
    if (await claimedOwner()) throw new HttpError(409, HAS_OWNER)
    const bytes = randomBytes(CODE_LENGTH)
    const code = Array.from(bytes, (byte) => CODE_LETTERS[byte % CODE_LETTERS.length]).join('').match(/.{4}/g)?.join('-') ?? ''
    await db.insertInto('install_setting').values({ name: 'setup_code', value: sha(plain(code)) }).onConflict((oc) => oc.column('name').doUpdateSet({ value: sha(plain(code)) })).execute()
    return { object: 'setup_code', code, url: `${config.address}/setup?code=${code}` }
  },

  async resetOwner(): Promise<{ object: 'setup_code'; code: string; url: string }> {
    const owner = await db.updateTable('person').set({ pass: null }).where('role', '=', 'owner').returning('id').executeTakeFirst()
    if (owner) await db.deleteFrom('session').where('person_id', '=', owner.id).execute()
    emit({ name: 'owner.reset' })
    return teamService.mintSetupCode()
  },

  async createPerson(input: CreatePerson): Promise<{ person: Person; token: string }> {
    const person = 'setupCode' in input ? await claimOwner(input) : await acceptInvite(input)
    emit({ name: 'person.joined', actor: person, target: { type: 'person', id: person.id, role: person.role } })
    return { person, token: await openSession(person.id) }
  },

  async createSession({ email, password }: { email: string; password: string }): Promise<{ session: Session; token: string }> {
    const row = await db.selectFrom('person').selectAll().where('email', '=', email).where('removed_at', 'is', null).executeTakeFirst()
    if (!(await checkPassword({ password, stored: row?.pass })) || !row) throw new HttpError(401, 'That email and password don\'t match. Try again.')
    return sessionOf({ person: personOf(row), token: await openSession(row.id) })
  },

  async endSession({ token }: { token: string | undefined }): Promise<void> {
    if (token) await db.deleteFrom('session').where('hash', '=', sha(token)).execute()
  },

  async me({ caller }: { caller: Caller }): Promise<Me> {
    const person = await db.selectFrom('person').selectAll().where('id', '=', caller.id).executeTakeFirstOrThrow()
    return { object: 'me', user: personOf(person), timeZone: settings.timeZone() }
  },

  async listPeople(): Promise<Person[]> {
    return (await db.selectFrom('person').selectAll().where('removed_at', 'is', null).orderBy('created_at').execute()).map(personOf)
  },

  async updatePerson({ actor, id, role }: { actor: Caller; id: string; role: MemberRole }): Promise<Person> {
    requireAdmin(actor)
    const row = await db.updateTable('person').set({ role }).where('id', '=', id).where('role', '!=', 'owner').where('removed_at', 'is', null).returningAll().executeTakeFirst()
    if (!row) throw new HttpError(404, 'That person isn\'t on the team, or is the owner, whose role stays.')
    emit({ name: 'person.role_changed', actor, target: { type: 'person', id, role } })
    return personOf(row)
  },

  async deletePerson({ actor, id }: { actor: Caller; id: string }): Promise<Deleted<'person'>> {
    requireAdmin(actor)
    if (id === actor.id) throw new HttpError(403, 'You can\'t remove yourself.')
    const row = await db.transaction().execute(async (trx) => {
      const removed = await trx.updateTable('person').set({ removed_at: new Date(), pass: null }).where('id', '=', id).where('role', '!=', 'owner').where('removed_at', 'is', null).returning('id').executeTakeFirst()
      if (removed) await trx.deleteFrom('session').where('person_id', '=', id).execute()
      return removed
    })
    if (!row) throw new HttpError(404, 'That person isn\'t on the team, or is the owner, who always stays.')
    emit({ name: 'person.removed', actor, target: { type: 'person', id } })
    return deleted({ id, object: 'person' })
  },

  async createInvite({ actor, role }: { actor: Caller; role: MemberRole }): Promise<Invite> {
    requireAdmin(actor)
    const token = newToken('ohi')
    const expiresAt = new Date(Date.now() + INVITE_DAYS * DAY_MS)
    await db.insertInto('invite').values({ hash: sha(token), role, created_by: actor.id, expires_at: expiresAt }).execute()
    await db.deleteFrom('invite').where('expires_at', '<', new Date()).execute()
    emit({ name: 'invite.created', actor, target: { type: 'invite', id: sha(token).slice(0, 12), role } })
    return { object: 'invite', role, expiresAt: expiresAt.toISOString(), link: `${config.address}/invite/${token}` }
  },

  async getInvite({ token }: { token: string }): Promise<Invite> {
    const row = await db.selectFrom('invite').select(['role', 'expires_at']).where('hash', '=', sha(token)).where('expires_at', '>', new Date()).executeTakeFirst()
    if (!row) throw new HttpError(410, USED_INVITE)
    return { object: 'invite', role: row.role, expiresAt: new Date(row.expires_at).toISOString() }
  },

  async createPasswordReset({ email }: { email: string }): Promise<{ object: 'password_reset' }> {
    const server = settings.smtp()
    if (!server) throw new HttpError(409, 'This install can\'t send email. Ask the owner to reset your password.')
    const person = await db.selectFrom('person').select('id').where('email', '=', email).where('removed_at', 'is', null).executeTakeFirst()
    if (person) {
      const token = newToken('ohr')
      await db.insertInto('password_reset').values({ hash: sha(token), person_id: person.id, expires_at: new Date(Date.now() + RESET_MS) }).execute()
      await smtp.send({ server, to: email, subject: 'Reset your OpenHut password', text: `Open this link to pick a new password. It works once, for an hour.\n\n${config.address}/reset?token=${token}\n\nIf you didn't ask for this, ignore this email.` })
    }
    return { object: 'password_reset' }
  },

  async finishPasswordReset({ token, password }: { token: string; password: string }): Promise<{ session: Session; token: string }> {
    const pass = await hashPassword(password)
    const person = await db.transaction().execute(async (trx) => {
      const reset = await trx.deleteFrom('password_reset').where('hash', '=', sha(token)).where('expires_at', '>', new Date()).returning('person_id').executeTakeFirst()
      if (!reset) throw new HttpError(410, 'This reset link was already used or has expired. Ask for a new one.')
      await trx.deleteFrom('session').where('person_id', '=', reset.person_id).execute()
      return trx.updateTable('person').set({ pass }).where('id', '=', reset.person_id).where('removed_at', 'is', null).returningAll().executeTakeFirstOrThrow()
    })
    return sessionOf({ person: personOf(person), token: await openSession(person.id) })
  },

  beginGoogleSignIn(): string {
    if (!settings.googleSignIn()) throw new HttpError(409, 'Sign in with Google is off on this install.')
    const state = randomBytes(18).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    for (const [key, each] of googleSignIns) if (each.expires < Date.now()) googleSignIns.delete(key)
    googleSignIns.set(state, { verifier, expires: Date.now() + SIGN_IN_MS })
    return google.signInUrl({ redirectUri: googleRedirectUri(), state, verifier })
  },

  async finishGoogleSignIn({ state, code }: { state: string; code: string }): Promise<string> {
    const pending = googleSignIns.get(state)
    googleSignIns.delete(state)
    if (!pending || pending.expires < Date.now() || !settings.googleSignIn()) throw new HttpError(400, 'That Google sign-in expired. Try again.')
    const email = await google.verifiedEmail({ code, verifier: pending.verifier, redirectUri: googleRedirectUri() })
    const person = email && await db.selectFrom('person').select('id').where('email', '=', email).where('removed_at', 'is', null).executeTakeFirst()
    if (!person) throw new HttpError(403, `${email ?? 'That Google account'} isn't on this team. Ask for an invite with that email.`)
    return openSession(person.id)
  },
}

export const googleRedirectUri = (): string => `${config.address}/api/google-sign-in/callback`

async function claimedOwner(): Promise<boolean> {
  return !!(await db.selectFrom('person').select('id').where('role', '=', 'owner').where('pass', 'is not', null).executeTakeFirst())
}

async function claimOwner({ setupCode, email, password }: { setupCode: string; email: string; password: string }): Promise<Person> {
  const pass = await hashPassword(password)
  const owner = await db.transaction().execute(async (trx) => {
    const code = await trx.deleteFrom('install_setting').where('name', '=', 'setup_code').where('value', '=', sha(plain(setupCode))).returning('name').executeTakeFirst()
    if (!code) throw new HttpError(403, WRONG_CODE, { param: 'setupCode' })
    const current = await trx.selectFrom('person').select(['id', 'pass']).where('role', '=', 'owner').executeTakeFirst()
    if (current?.pass) throw new HttpError(409, HAS_OWNER)
    if (current) return trx.updateTable('person').set({ email, pass }).where('id', '=', current.id).returningAll().executeTakeFirstOrThrow()
    return trx.insertInto('person').values({ id: newId('usr'), email, pass, role: 'owner' }).returningAll().executeTakeFirstOrThrow()
  }).catch((err: unknown) => { throw isUniqueViolation(err) ? new HttpError(409, 'Someone on the team already uses that email. Use another one.', { param: 'email' }) : err })
  emit({ name: 'setup.completed', actor: owner, target: { type: 'person', id: owner.id } })
  return personOf(owner)
}

async function acceptInvite({ inviteToken, name, email, password }: { inviteToken: string; name: string; email: string; password: string }): Promise<Person> {
  const pass = await hashPassword(password)
  return db.transaction().execute(async (trx) => {
    const invite = await trx.deleteFrom('invite').where('hash', '=', sha(inviteToken)).where('expires_at', '>', new Date()).returning('role').executeTakeFirst()
    if (!invite) throw new HttpError(410, USED_INVITE)
    const fields = { name, pass, role: invite.role, removed_at: null, created_at: new Date() }
    const person = await trx.insertInto('person').values({ id: newId('usr'), email, ...fields })
      .onConflict((oc) => oc.column('email').doUpdateSet(fields).where('person.removed_at', 'is not', null)).returningAll().executeTakeFirst()
    if (!person) throw new HttpError(409, 'Someone on the team already uses that email. Use another one, or sign in.', { param: 'email' })
    return personOf(person)
  })
}

async function openSession(personId: string): Promise<string> {
  const token = newToken('ohs')
  await db.insertInto('session').values({ hash: sha(token), person_id: personId, expires_at: new Date(Date.now() + SESSION_DAYS * DAY_MS) }).execute()
  await db.deleteFrom('session').where('expires_at', '<', new Date()).execute()
  return token
}

function sessionOf({ person, token }: { person: Person; token: string }): { session: Session; token: string } {
  return { session: { id: sha(token).slice(0, 16), object: 'session', person, expiresAt: new Date(Date.now() + SESSION_DAYS * DAY_MS).toISOString() }, token }
}

const plain = (code: string): string => code.toUpperCase().replace(/[^A-Z0-9]/g, '')

function personOf(row: Selectable<Database['person']>): Person {
  return { id: row.id, object: 'person', email: row.email, name: row.name || row.email.split('@')[0] || row.email, role: row.role, joinedAt: new Date(row.created_at).toISOString() }
}
