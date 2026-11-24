import { createHash, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer, type Server as NetServer } from 'node:net'
import { userInfo } from 'node:os'
import type { Duplex } from 'node:stream'
import type { FastifyRequest } from 'fastify'
import * as z from 'zod/mini'
import { bodyOf } from '@openhut/common/cloud/member-list.ts'
import { fromBase64 } from '@openhut/common/vault/vault.ts'
import { keyStore } from '../cloud/key-store.ts'
import { config } from '../platform/config.ts'
import { db, isUniqueViolation } from '../platform/db.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { newId } from '../platform/secrets.ts'

const LOCAL = Symbol('local')
const DEVICE = Symbol('device')
const OWN_DEVICES = new Set([
  'GET /api/threads', 'GET /api/threads/:id', 'DELETE /api/threads/:id', 'POST /api/threads/:id/chat',
  'GET /api/threads/:id/files', 'POST /api/threads/:id/files', 'DELETE /api/threads/:id/files', 'POST /api/threads/:id/files/lookups',
  'GET /api/browsers/:id/live', 'GET /api/channels/:id', 'GET /api/connection-events', 'POST /api/updates',
])
const TEAMMATES = new Set(['GET /api/threads/:id', 'POST /api/threads/:id/chat'])
const IdParams = z.object({ id: z.string() })

export async function who(req: FastifyRequest): Promise<Caller> {
  const { local, device } = arrival(req)
  if (local) return { ...await owner(), local: true }
  if (device === undefined) throw new HttpError(401, 'Send the key the OpenHut app enrolled with this computer, as Authorization: Bearer <key>.')
  const member = memberOf(device)
  if (!member) throw new HttpError(401, 'This device isn’t on your list anymore, so it can’t reach this computer.')
  const route = `${req.method} ${req.routeOptions.url ?? ''}`
  const allowed = member.own ? OWN_DEVICES.has(route) : TEAMMATES.has(route) && await sharedWith({ req, workspaces: member.workspaces })
  if (!allowed) throw new HttpError(403, member.own ? 'Only this computer’s own app can do that. From another device you can chat, watch the browser, link WhatsApp, read files and the connection log, and update.' : 'You can only chat with the agents your team shares.')
  return { id: (await owner()).id, email: member.email, local: false }
}

export async function requireSignIn(req: FastifyRequest): Promise<void> {
  await who(req)
}

export function enrolled(header: string | undefined): boolean {
  const key = /^Bearer (\S+)$/.exec(header ?? '')?.[1]
  if (!key || !config.clientKeySha256) return false
  return timingSafeEqual(createHash('sha256').update(key).digest(), Buffer.from(config.clientKeySha256, 'hex'))
}

export function tagDevice<T extends Duplex>({ conn, key }: { conn: T; key: string }): T {
  return Object.assign(conn, { [DEVICE]: key })
}

export function fromTunnel(req: FastifyRequest): boolean {
  return arrival(req).device !== undefined
}

export function tunnelKeyOf(device: string): string {
  return Buffer.from(fromBase64(device).subarray(32)).toString('hex')
}

export function memberOf(key: string): { email: string; own: boolean; workspaces: string[] } | undefined {
  const account = keyStore.current()?.account
  if (!account) return undefined
  const found = [account, ...account.teams ?? []].flatMap((room) => {
    const body = bodyOf(room.list)
    const member = body?.members.find((each) => each.devices.some((device) => device !== each.kit && !body.removed.includes(device) && tunnelKeyOf(device) === key))
    return member ? [{ email: member.email, workspace: room.workspace.id }] : []
  })
  const first = found[0]
  return first && { email: first.email, own: first.email === account.email, workspaces: found.map((each) => each.workspace) }
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

function arrival(req: FastifyRequest): { local: boolean; device?: string } {
  const conn = req.raw.socket as (Duplex & { [LOCAL]?: true; [DEVICE]?: string }) | undefined
  if (conn?.[LOCAL]) return { local: true }
  if (conn?.[DEVICE] !== undefined) return { local: false, device: conn[DEVICE] }
  return { local: enrolled(req.headers.authorization) }
}

async function sharedWith({ req, workspaces }: { req: FastifyRequest; workspaces: string[] }): Promise<boolean> {
  const agentId = z.safeParse(IdParams, req.params).data?.id
  const agent = agentId ? await db.selectFrom('agent').select(['workspace', 'shared']).where('id', '=', agentId).executeTakeFirst() : undefined
  const place = agent?.workspace ?? keyStore.current()?.account?.workspace.id
  return !!agent?.shared && !!place && workspaces.includes(place)
}

async function owner(): Promise<Owner> {
  const person = await theOwner() ?? await claimOwner()
  return { id: person.id, email: keyStore.current()?.account?.email ?? person.email }
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
