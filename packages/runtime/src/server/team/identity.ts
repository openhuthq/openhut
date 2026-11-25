import { createHash, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, rmSync } from 'node:fs'
import type { Server } from 'node:http'
import { createServer, type Server as NetServer } from 'node:net'
import { userInfo } from 'node:os'
import type { Duplex } from 'node:stream'
import type { FastifyRequest } from 'fastify'
import * as z from 'zod/mini'
import { canUse } from '@openhut/common/agents/agent.ts'
import { bodyOf } from '@openhut/common/cloud/member-list.ts'
import { fromBase64 } from '@openhut/common/vault/public.ts'
import { keyStore } from '../cloud/key-store.ts'
import { keysService } from '../cloud/keys-service.ts'
import { userPresence } from '../cloud/user-presence.ts'
import { config } from '../platform/config.ts'
import { db, isUniqueViolation } from '../platform/db.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { newId } from '../platform/secrets.ts'
import { settings } from '../platform/settings.ts'
import { IdParams } from '../platform/responses.ts'

const LOCAL = Symbol('local')
const DEVICE = Symbol('device')
const TRUST = /^(POST|PUT|PATCH|DELETE) \/api\/cloud(\/|$)/
const TEAMMATES = new Set(['GET /api/threads/:id', 'POST /api/threads/:id/chat'])
const TEAMMATE_LISTS = new Set(['GET /api/agents'])
const SERVER_KIT = 'POST /api/cloud/kits'
const CHANGES = ['instructions', 'codeExecution', 'browser', 'runsHere', 'runsOn', 'shared', 'people', 'sidebars', 'model']
const STEP_UP: Record<string, (body: unknown) => boolean> = {
  'POST /api/agents': () => config.installKind !== 'server',
  'PATCH /api/agents/:id': (body) => typeof body === 'object' && body !== null && CHANGES.some((field) => field in body),
  'DELETE /api/agents/:id': () => true,
  'POST /api/grants': () => true,
  'DELETE /api/grants/:id': () => true,
  'POST /api/change-requests/:id/approvals': () => true,
  'POST /api/connections': () => true,
  'DELETE /api/connections/:id': () => true,
  'POST /api/connection-authorizations': () => true,
  'PATCH /api/providers/:id': () => true,
  'POST /api/providers/:id/refresh': () => true,
  'DELETE /api/providers/:id': () => true,
}

export async function who(req: FastifyRequest): Promise<Caller> {
  const { local, device } = arrival(req)
  if (local) return { ...await owner(), local: true }
  if (device === undefined) throw new HttpError(401, 'Send the key the OpenHut app enrolled with this computer, as Authorization: Bearer <key>.')
  const member = memberOf(device)
  if (!member) throw new HttpError(401, 'This device isn’t on your list anymore, so it can’t reach this computer.')
  const route = routeOf(req)
  const allowed = member.own ? isOwnWindow(device) || !TRUST.test(route) || firstKitOnAServer(route) : TEAMMATE_LISTS.has(route) || (TEAMMATES.has(route) && await sharedWith({ req, email: member.email, workspaces: member.workspaces }))
  if (!allowed) throw new HttpError(403, member.own ? 'Do this on your computer: devices, keys, the recovery kit and sign-in change only in the OpenHut app there.' : 'You can only chat with the agents your team shares.')
  return { id: (await owner()).id, email: member.email, local: false, ...!member.own && { teammate: member.workspaces } }
}

export async function stepUp(req: FastifyRequest): Promise<void> {
  const { device } = arrival(req)
  const member = device === undefined ? undefined : memberOf(device)
  if (!member?.own || isOwnWindow(device) || !STEP_UP[routeOf(req)]?.(req.body)) return
  if (!await userPresence.ask('let your browser or phone make this change')) throw new HttpError(403, 'Not confirmed on your computer, so nothing changed. Confirm it there to go ahead.', { param: 'presence' })
}

export async function requireSignIn(req: FastifyRequest): Promise<void> {
  await who(req)
}

export function withPresence(reason: string): (req: FastifyRequest) => Promise<void> {
  return async (req) => {
    await who(req)
    if (!await userPresence.ask(reason)) throw new HttpError(403, 'Not confirmed. Nothing changed.', { param: 'presence' })
  }
}

export function atHome(req: FastifyRequest): boolean {
  const { device } = arrival(req)
  return device === undefined || isOwnWindow(device)
}

export function enrolled(header: string | undefined): boolean {
  const key = /^Bearer (\S+)$/.exec(header ?? '')?.[1]
  if (!key || !config.clientKeySha256) return false
  return timingSafeEqual(createHash('sha256').update(key).digest(), Buffer.from(config.clientKeySha256, 'hex'))
}

export function tagDevice<T extends Duplex>({ conn, key }: { conn: T; key: string }): T {
  return Object.assign(conn, { [DEVICE]: key })
}

function isOwnWindow(device: string | undefined): boolean {
  const own = settings.ownWindow()
  return device !== undefined && own !== undefined && tunnelKeyOf(own) === device
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

function routeOf(req: FastifyRequest): string {
  return `${req.method} ${req.routeOptions.url ?? ''}`
}

function firstKitOnAServer(route: string): boolean {
  return route === SERVER_KIT && config.installKind === 'server' && !keysService.kitState().saved
}

async function sharedWith({ req, email, workspaces }: { req: FastifyRequest; email: string; workspaces: string[] }): Promise<boolean> {
  const agentId = z.safeParse(IdParams, req.params).data?.id
  const agent = agentId ? await db.selectFrom('agent').select(['workspace', 'shared', 'people', 'owner']).where('id', '=', agentId).executeTakeFirst() : undefined
  const place = agent?.workspace ?? keyStore.current()?.account?.workspace.id
  return !!agent && canUse({ owner: agent.owner ?? '', shared: agent.shared, people: peopleOf(agent.people), sidebars: [] }, email) && !!place && workspaces.includes(place)
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
export type Caller = Owner & { local: boolean; teammate?: string[] }

export function peopleOf(json: string): string[] {
  try {
    const people: unknown = JSON.parse(json)
    return Array.isArray(people) ? people.filter((each): each is string => typeof each === 'string') : []
  } catch {
    return []
  }
}
