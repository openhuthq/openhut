import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
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
const DEVICE = Symbol('device')
const INNER = randomBytes(32)

export async function who(req: FastifyRequest): Promise<Caller> {
  const caller = await callerOf(req)
  if (caller) return caller
  throw new HttpError(401, 'Send the key the OpenHut app enrolled with this computer, as Authorization: Bearer <key>.')
}

export async function requireSignIn(req: FastifyRequest): Promise<void> {
  await who(req)
}

export async function callerOf(req: FastifyRequest): Promise<Caller | undefined> {
  const { allowed, local } = arrival(req)
  if (!allowed) return undefined
  const owner = await theOwner() ?? await claimOwner()
  return owner && { ...owner, local }
}

export function enrolled(header: string | undefined): boolean {
  const key = /^Bearer (\S+)$/.exec(header ?? '')?.[1]
  if (!key || !config.clientKeySha256) return false
  return timingSafeEqual(createHash('sha256').update(key).digest(), Buffer.from(config.clientKeySha256, 'hex'))
}

export function innerAuthorization({ local }: Caller): string {
  return `Inner ${INNER.toString('hex')} ${local ? 'local' : 'remote'}`
}

export function tagDevice<T extends Duplex>({ conn, key }: { conn: T; key: string }): T {
  return Object.assign(conn, { [DEVICE]: key })
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

function arrival(req: FastifyRequest): { allowed: boolean; local: boolean } {
  const conn = req.raw.socket as (Duplex & { [LOCAL]?: true; [DEVICE]?: string }) | undefined
  if (conn?.[LOCAL]) return { allowed: true, local: true }
  if (conn?.[DEVICE] !== undefined) return { allowed: isClient(conn[DEVICE]), local: false }
  const inner = /^Inner ([0-9a-f]{64}) (local|remote)$/.exec(req.headers.authorization ?? '')
  if (inner) return { allowed: timingSafeEqual(Buffer.from(inner[1], 'hex'), INNER), local: inner[2] === 'local' }
  return { allowed: enrolled(req.headers.authorization), local: false }
}

function isClient(_device: string): boolean {
  return false
}

function theOwner(): Promise<Owner | undefined> {
  return db.selectFrom('person').select(['id', 'email']).where('role', '=', 'owner').executeTakeFirst()
}

async function claimOwner(): Promise<Owner | undefined> {
  const owner = await db.insertInto('person').values({ id: newId('usr'), email: userInfo().username, role: 'owner', removed_at: null }).returning(['id', 'email']).executeTakeFirstOrThrow()
    .catch((err: unknown) => { if (isUniqueViolation(err)) return undefined; throw err })
  if (owner) emit({ name: 'setup.completed', actor: owner, target: { type: 'person', id: owner.id } })
  return owner ?? theOwner()
}

type Owner = { id: string; email: string }
export type Caller = Owner & { local: boolean }
