import { createHash, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer, type Server as NetServer } from 'node:net'
import { userInfo } from 'node:os'
import type { Duplex } from 'node:stream'
import type { FastifyRequest } from 'fastify'
import { config } from '../platform/config.ts'
import { db, isUniqueViolation } from '../platform/db.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { newId } from '../platform/secrets.ts'

const LOCAL = Symbol('local')

export async function who(req: FastifyRequest): Promise<Caller> {
  if (!arrival(req)) throw new HttpError(401, 'Send the key this install was set up with, as Authorization: Bearer <key>.')
  return { ...await owner(), local: true }
}

export async function requireSignIn(req: FastifyRequest): Promise<void> {
  await who(req)
}

export function enrolled(header: string | undefined): boolean {
  const key = /^Bearer (\S+)$/.exec(header ?? '')?.[1]
  if (!key || !config.clientKeySha256) return false
  return timingSafeEqual(createHash('sha256').update(key).digest(), Buffer.from(config.clientKeySha256, 'hex'))
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

function arrival(req: FastifyRequest): boolean {
  const conn = req.raw.socket as (Duplex & { [LOCAL]?: true }) | undefined
  return !!conn?.[LOCAL] || enrolled(req.headers.authorization)
}

async function owner(): Promise<Owner> {
  const person = await theOwner() ?? await claimOwner()
  return { id: person.id, email: person.email }
}

function theOwner(): Promise<Owner | undefined> {
  return db.selectFrom('person').select(['id', 'email']).where('role', '=', 'owner').executeTakeFirst()
}

async function claimOwner(): Promise<Owner> {
  const owner = await db.insertInto('person').values({ id: newId('usr'), email: userInfo().username, role: 'owner', removed_at: null }).returning(['id', 'email']).executeTakeFirstOrThrow()
    .catch((err: unknown) => { if (isUniqueViolation(err)) return undefined; throw err })
  if (owner) emit({ name: 'setup.completed', actor: owner, target: { type: 'person', id: owner.id } })
  const found = owner ?? await theOwner()
  if (!found) throw new HttpError(500, 'This computer has no owner yet. Restart OpenHut and try again.')
  return found
}

type Owner = { id: string; email: string }
export type Caller = Owner & { local: boolean }

export function peopleOf(json: string): string[] {
  try {
    const people: unknown = JSON.parse(json)
    return Array.isArray(people) ? people.filter((each): each is string => typeof each === 'string') : []
  } catch {
    return []
  }
}
