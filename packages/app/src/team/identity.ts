import type { FastifyReply, FastifyRequest } from 'fastify'
import type { TeamRole } from '@fastmonkey/common/team/team.ts'
import { db } from '../platform/db.ts'
import { HttpError } from '../platform/http-error.ts'
import { sha } from '../platform/secrets.ts'
import { ACCESS_TOKEN, oauthService } from './oauth-service.ts'

const COOKIE = 'fm_session'
export const SESSION_DAYS = 7

export const isAdmin = (caller: Caller): boolean => caller.role === 'owner' || caller.role === 'admin'

export async function who(req: FastifyRequest): Promise<Caller> {
  const caller = await callerOf(req)
  if (caller) return caller
  if (ACCESS_TOKEN.test(req.headers.authorization ?? '')) throw new HttpError(401, 'This sign-in expired or the app was disconnected. Connect the app to Fast Monkey again.')
  throw new HttpError(401, 'Sign in first.')
}

export async function requireSignIn(req: FastifyRequest): Promise<void> {
  await who(req)
}

export async function callerOf(req: FastifyRequest): Promise<Caller | undefined> {
  const access = ACCESS_TOKEN.exec(req.headers.authorization ?? '')?.[1]
  if (access) return activePerson(await oauthService.owner(access))
  const session = sessionToken(req)
  if (!session) return undefined
  return db.selectFrom('session as s').innerJoin('person as p', 'p.id', 's.person_id').select(['p.id', 'p.email', 'p.role'])
    .where('s.hash', '=', sha(session)).where('s.expires_at', '>', new Date()).where('p.removed_at', 'is', null).executeTakeFirst()
}

export const sessionToken = (req: FastifyRequest): string | undefined =>
  (req.headers.cookie ?? '').split(/;\s*/).find((part) => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1)

export function setSessionCookie({ reply, token }: { reply: FastifyReply; token: string }): void {
  reply.header('set-cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}`)
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
}

async function activePerson(id: string | undefined): Promise<Caller | undefined> {
  if (!id) return undefined
  return db.selectFrom('person').select(['id', 'email', 'role']).where('id', '=', id).where('removed_at', 'is', null).executeTakeFirst()
}

export type Caller = { id: string; email: string; role: TeamRole }
