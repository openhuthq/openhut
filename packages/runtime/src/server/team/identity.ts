import { createHash, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer, type Server as NetServer } from 'node:net'
import type { Duplex } from 'node:stream'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { TeamRole } from '@openhut/common/team/team.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import { HttpError } from '../platform/http-error.ts'
import { newId, sha } from '../platform/secrets.ts'

const LOCAL = Symbol('local')
const COOKIE = 'openhut_session'
const DEV_OWNER = 'owner@example.com'
export const SESSION_DAYS = 30

export async function who(req: FastifyRequest): Promise<Caller> {
  const caller = await sessionCaller(req) ?? await devCaller(req)
  if (!caller) throw new HttpError(401, 'Sign in first.')
  return caller
}

export async function requireSignIn(req: FastifyRequest): Promise<void> {
  await who(req)
}

export const isAdmin = (caller: Caller): boolean => caller.role === 'owner' || caller.role === 'admin'

export function requireAdmin(caller: Caller): void {
  if (!isAdmin(caller)) throw new HttpError(403, 'Only the owner or an admin can do that.')
}

export async function admin(req: FastifyRequest): Promise<Caller> {
  const caller = await who(req)
  requireAdmin(caller)
  return caller
}

export function isLocal(req: FastifyRequest): boolean {
  return !!(req.raw.socket as (Duplex & { [LOCAL]?: true }) | undefined)?.[LOCAL]
}

export async function requireLocal(req: FastifyRequest): Promise<void> {
  if (!isLocal(req)) throw new HttpError(403, 'Run this on the server: docker exec openhut openhut <command>.')
}

export const GOOGLE_STATE = 'openhut_google_state'

export const cookieOf = ({ req, name }: { req: FastifyRequest; name: string }): string | undefined =>
  (req.headers.cookie ?? '').split(/;\s*/).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1)

export const sessionToken = (req: FastifyRequest): string | undefined => cookieOf({ req, name: COOKIE })

export function googleStateCookie({ value, maxAge }: { value: string; maxAge: number }): string {
  return `${GOOGLE_STATE}=${value}; HttpOnly; SameSite=Lax; Path=/api/google-sign-in; Max-Age=${maxAge}${secure()}`
}

export function setSessionCookie({ reply, token }: { reply: FastifyReply; token: string }): void {
  reply.header('set-cookie', cookie(token, SESSION_DAYS * 86400))
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.header('set-cookie', cookie('', 0))
}

export async function listenLocally({ server, path }: { server: Server; path: string }): Promise<NetServer> {
  const pipe = process.platform === 'win32'
  if (!pipe) rmSync(path, { force: true })
  const local = createServer((conn) => { server.emit('connection', Object.assign(conn, { [LOCAL]: true })) })
  const umask = process.umask(0o177)
  try {
    await once(local.listen(path), 'listening')
  } finally {
    process.umask(umask)
  }
  if (!pipe) chmodSync(path, 0o600)
  return local
}

function cookie(value: string, maxAge: number): string {
  return `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure()}`
}

const secure = (): string => config.address.startsWith('https:') ? '; Secure' : ''

async function sessionCaller(req: FastifyRequest): Promise<Caller | undefined> {
  const token = sessionToken(req)
  if (!token) return undefined
  return db.selectFrom('session as s').innerJoin('person as p', 'p.id', 's.person_id').select(['p.id', 'p.email', 'p.role'])
    .where('s.hash', '=', sha(token)).where('s.expires_at', '>', new Date()).where('p.removed_at', 'is', null).executeTakeFirst()
}

async function devCaller(req: FastifyRequest): Promise<Caller | undefined> {
  const key = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1]
  if (!key || !config.devKeySha256) return undefined
  if (!timingSafeEqual(createHash('sha256').update(key).digest(), Buffer.from(config.devKeySha256, 'hex'))) return undefined
  await db.insertInto('person').values({ id: newId('usr'), email: DEV_OWNER, role: 'owner' }).onConflict((oc) => oc.doNothing()).execute()
  return db.selectFrom('person').select(['id', 'email', 'role']).where('role', '=', 'owner').executeTakeFirstOrThrow()
}

export type Caller = { id: string; email: string; role: TeamRole }

export function peopleOf(json: string): string[] {
  try {
    const people: unknown = JSON.parse(json)
    return Array.isArray(people) ? people.filter((each): each is string => typeof each === 'string') : []
  } catch {
    return []
  }
}
