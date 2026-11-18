import { createHash, timingSafeEqual } from 'node:crypto'
import { userInfo } from 'node:os'
import type { FastifyRequest } from 'fastify'
import { config } from '../platform/config.ts'
import { db, isUniqueViolation } from '../platform/db.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { newId } from '../platform/secrets.ts'

export async function who(req: FastifyRequest): Promise<Caller> {
  const caller = await callerOf(req)
  if (caller) return caller
  throw new HttpError(401, 'Send the key the OpenHut app enrolled with this computer, as Authorization: Bearer <key>.')
}

export async function requireSignIn(req: FastifyRequest): Promise<void> {
  await who(req)
}

export async function callerOf(req: FastifyRequest): Promise<Caller | undefined> {
  if (!config.socket && !enrolled(req.headers.authorization)) return undefined
  return await theOwner() ?? await claimOwner()
}

export function enrolled(header: string | undefined): boolean {
  const key = /^Bearer (\S+)$/.exec(header ?? '')?.[1]
  if (!key || !config.clientKeySha256) return false
  return timingSafeEqual(createHash('sha256').update(key).digest(), Buffer.from(config.clientKeySha256, 'hex'))
}

function theOwner(): Promise<Caller | undefined> {
  return db.selectFrom('person').select(['id', 'email']).where('role', '=', 'owner').executeTakeFirst()
}

async function claimOwner(): Promise<Caller | undefined> {
  const owner = await db.insertInto('person').values({ id: newId('usr'), email: userInfo().username, role: 'owner', removed_at: null }).returning(['id', 'email']).executeTakeFirstOrThrow()
    .catch((err: unknown) => { if (isUniqueViolation(err)) return undefined; throw err })
  if (owner) emit({ name: 'setup.completed', actor: owner, target: { type: 'person', id: owner.id } })
  return owner ?? theOwner()
}

export type Caller = { id: string; email: string }
