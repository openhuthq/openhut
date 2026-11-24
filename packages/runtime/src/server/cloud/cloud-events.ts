import ReconnectingWebSocket from 'partysocket/ws'
import * as z from 'zod/mini'
import { type Cloud, type DeviceRequest, parseJson, siteHost } from '@openhut/common/cloud/cloud.ts'
import { Forwarded, Notice, Ready } from '@openhut/common/cloud/v1/events.ts'
import { commitOf, facesOf } from '@openhut/common/cloud/faces.ts'
import { anchorOf, bodyOf } from '@openhut/common/cloud/member-list.ts'
import type { MemberListBody } from '@openhut/common/cloud/cloud.ts'
import { padded } from '@openhut/common/records/row.ts'
import { keyring } from '@openhut/common/keyring/keyring.ts'
import { Collection } from '@openhut/common/records/wire.ts'
import { AgentHealth, AgentStatus } from '@openhut/common/agents/agent.ts'
import { fromBase64, toBase64 } from '@openhut/common/vault/public.ts'
import { agentService } from '../agents/agent-service.ts'
import { CloudError } from '@openhut/common/cloud/openhut-cloud.ts'
import { cloud } from '../platform/cloud.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import { emit, log } from '../platform/events.ts'
import { messageOf } from '../platform/http-error.ts'
import { deviceOs, keysService } from './keys-service.ts'
import { presence } from './presence.ts'
import { changed, recordsService } from './records.ts'
import { runSet } from './run-set.ts'
import { roomKeys } from './room-keys.ts'

export const BEAT_MS = 10_000
const GONE = [4001, 4003, 4010]
const REFUSED_AGAIN_MS = 2000
const LIVE: Record<Collection, string[]> = {
  workspace: [], agent: ['agent'], control: ['agent', 'grant'], message: ['thread'], memory: ['memory'], connection: ['connection'], skill: ['skill'], routine: ['routine'], channel: ['channel'], file: ['thread'],
}
const Beat = z.object({ at: z.number(), build: z.string(), version: z.string(), kind: z.string(), os: z.optional(z.string()), agents: z.optional(z.record(z.string(), z.object({ status: AgentStatus, health: z.nullable(AgentHealth), detail: z.optional(z.string()) }))) })
const Named = z.object({ name: z.optional(z.nullable(z.string())), site: z.optional(z.nullable(z.string())) })

export type Beat = z.infer<typeof Beat>
export type Gone = { name: string; why: 'removed' | 'deleted'; owner: string | null }
export type TurnedDown = Cloud['turnedDown'][number]

let socket: ReconnectingWebSocket | undefined
let ready = false
let timer: NodeJS.Timeout | undefined
let queue: Promise<void> = Promise.resolve()
let rotate: ((ws: string) => Promise<void>) | undefined
const names = new Map<string, { name: string | null; site: string | null }>()
const requests = new Map<string, DeviceRequest[]>()
const beats = new Map<string, Map<string, Beat>>()
const gone: Gone[] = []
const turnedDown: TurnedDown[] = []
const deniedHere = new Set<string>()
const GONE_SETTING = 'cloud.gone'
const GONE_KEPT = 20
let goneLoaded = false
const doubted = new Set<string>()

presence.wire({
  rooms: () => ready ? roomKeys.rooms().map((room) => room.workspace.id) : [],
  roomOf: async (agent) => {
    const row = await db.selectFrom('agent').select(['workspace', 'shared']).where('id', '=', agent).executeTakeFirst()
    const ws = row?.shared ? row.workspace ?? keysService.account()?.workspace.id : undefined
    return ws && roomKeys.room(ws) ? ws : null
  },
  context: async (ws) => {
    const account = keysService.account()
    const room = roomKeys.room(ws)
    const body = bodyOf(room?.list)
    if (!account || !room?.workspace.key || !body) return null
    return { workspace: ws, me: await keysService.deviceKey(), members: body.members, email: account.email, list: body.version, listHash: await anchorOf(room.list) }
  },
  send: ({ ws, body }) => sent({ type: 'presence', workspace: ws, body }),
  catchUp: (ws) => void run(() => refreshKeys(ws)),
})

recordsService.onRefused((workspace) => {
  if (socket && workspace === keysService.account()?.workspace.id) void run(() => removedNow(workspace))
})

export const cloudEvents = {
  start(): void {
    if (socket || !keysService.account() || !keysService.session()) return
    let opened: ReconnectingWebSocket | undefined
    cloud.watch({
      socket: (url) => (opened = new ReconnectingWebSocket(url, [], { WebSocket: globalThis.WebSocket })),
      onMessage: heard,
      onHello: (err) => { if (err) log.warn({ event: 'cloud.refresh_failed', error: messageOf(err) }) },
    })
    if (!opened) return
    socket = opened
    opened.addEventListener('close', (event) => {
      ready = false
      for (const room of roomKeys.rooms()) presence.closed(room.workspace.id)
      if (GONE.includes(event.code)) void run(checkRemoved)
    })
    timer = setInterval(() => {
      void beatAll()
      void recordsService.drain()
    }, BEAT_MS)
    timer.unref()
  },

  stop(): void {
    socket?.close()
    socket = undefined
    ready = false
    clearInterval(timer)
    presence.forget()
  },

  ready: (): boolean => ready,

  onDropped(listener: (ws: string) => Promise<void>): void {
    rotate = listener
  },

  name: (ws: string): string => names.get(ws)?.name ?? defaultName(ws),
  named: (ws: string): string | null => names.get(ws)?.name ?? null,
  site: (ws: string): string | null => names.get(ws)?.site ?? null,
  requests: (ws: string): DeviceRequest[] => requests.get(ws) ?? [],
  beats: (ws: string): Map<string, Beat> => beats.get(ws) ?? new Map(),
  turnedDown: (): TurnedDown[] => turnedDown,
  deniedHere: (device: string): void => void deniedHere.add(device),
  async gone(): Promise<Gone[]> {
    await keptGone()
    return gone
  },

  refreshName: (ws: string): Promise<void> => run(() => refreshName(ws)),
  refreshRequests: (ws: string): Promise<void> => run(() => refreshRequests(ws)),
  refreshKeys: (ws: string): Promise<void> => run(() => refreshKeys(ws)),
  settled: (): Promise<void> => queue,

  async drop({ ws, why }: { ws: string; why: Gone['why'] | null }): Promise<void> {
    const own = roomKeys.isOwn(ws)
    if (why) await keepGone({ name: cloudEvents.name(ws), why, owner: roomKeys.members(ws)?.members.find((member) => member.role === 'owner')?.email ?? null })
    names.delete(ws)
    requests.delete(ws)
    presence.closed(ws)
    await roomKeys.dropRoom(ws)
    if (!own) await runSet.refresh().catch((err: unknown) => log.warn({ event: 'run_set.refresh_failed', error: messageOf(err) }))
    emit({ name: 'cloud.changed', target: { type: 'cloud', id: ws } })
  },
}

async function keptGone(): Promise<void> {
  if (goneLoaded) return
  goneLoaded = true
  const row = await db.selectFrom('install_setting').select('value').where('name', '=', GONE_SETTING).executeTakeFirst()
  const kept = z.safeParse(z.array(z.object({ name: z.string(), why: z.enum(['removed', 'deleted']), owner: z.nullable(z.string()) })), parseJson(row?.value ?? '[]')).data ?? []
  gone.unshift(...kept)
}

async function keepGone(entry: Gone): Promise<void> {
  await keptGone()
  gone.push(entry)
  gone.splice(0, Math.max(0, gone.length - GONE_KEPT))
  const value = JSON.stringify(gone)
  await db.insertInto('install_setting').values({ name: GONE_SETTING, value }).onConflict((oc) => oc.column('name').doUpdateSet({ value })).execute()
}

function heard(text: string): void {
  const json = parseJson(text)
  const forwarded = Forwarded.safeParse(json).data
  if (forwarded?.object === 'beat') return void beatHeard(forwarded)
  if (forwarded?.object === 'presence') return void presence.heard({ ws: forwarded.workspace, from: forwarded.from, at: Date.now(), body: forwarded.body })
  if (Ready.safeParse(json).success) {
    ready = true
    void run(async () => {
      for (const room of roomKeys.rooms()) {
        const ws = room.workspace.id
        await refreshKeys(ws)
        await refreshName(ws)
        await refreshRequests(ws)
        presence.ready(ws)
      }
    })
    void beatAll()
    void recordsService.drain()
    void runSet.refresh().catch((err: unknown) => log.warn({ event: 'run_set.refresh_failed', error: messageOf(err) }))
  }
  const notice = Notice.safeParse(json).data
  if (notice) noticed(notice)
}

function noticed({ object, id, ver, workspace, why }: Notice): void {
  const collection = Collection.safeParse(object).data
  if (collection) {
    changed({ collection, id, ver, workspace })
    for (const type of LIVE[collection]) emit({ name: `${type}.changed`, target: { type, id } })
  }
  if (object === 'member_list' || object === 'letter') void run(() => refreshKeys(workspace))
  if (object === 'join_request' && why) alert({ ws: workspace, device: id, why })
  if (object === 'join_request') void run(() => refreshRequests(workspace))
  if (object === 'workspace' && id === workspace) void run(() => refreshName(workspace))
}

function alert({ ws, device, why }: { ws: string; device: string; why: TurnedDown['why'] }): void {
  if (deniedHere.delete(device)) return
  const asked = requests.get(ws)?.find((each) => each.device === device)
  const place = asked?.location && [asked.location.city, asked.location.country].filter(Boolean).join(', ')
  turnedDown.push({ device, workspace: ws, name: asked?.name ?? null, email: asked?.email ?? null, place: place || null, why, at: new Date().toISOString() })
  turnedDown.splice(0, Math.max(0, turnedDown.length - GONE_KEPT))
  emit({ name: 'cloud.changed', target: { type: 'cloud', id: ws } })
}

async function beatAll(): Promise<void> {
  if (!ready) return
  const me = await keysService.deviceKey()
  for (const room of roomKeys.rooms()) {
    const ws = room.workspace.id
    const value: Beat = { at: Date.now(), build: config.build, version: config.version, kind: config.installKind, os: deviceOs(), agents: await agentService.statuses({ workspace: ws }) }
    const listed = roomKeys.members(ws)?.members.some((member) => member.devices.includes(me))
    const plain = padded({ json: JSON.stringify(value) })
    const body = listed && plain && await keyring.lock({ team: ws, bind: beatBind({ ws, from: me }), plain })
    if (body) sent({ type: 'beat', workspace: ws, body })
  }
}

async function beatHeard({ workspace, from, body }: { workspace: string; from: string; body: string }): Promise<void> {
  const listed = roomKeys.members(workspace)?.members.some((member) => member.devices.includes(from))
  const plain = listed ? await keyring.unlock({ team: workspace, bind: beatBind({ ws: workspace, from }), body }) : null
  const value = plain && Beat.safeParse(parseJson(new TextDecoder().decode(plain).trimEnd())).data
  if (!value) return
  const room = beats.get(workspace) ?? new Map<string, Beat>()
  const first = !room.has(from)
  room.set(from, value)
  beats.set(workspace, room)
  if (first) emit({ name: 'computer.beat', target: { type: 'admin', id: from } })
}

function sent(message: { type: 'beat' | 'presence'; workspace: string; body: string }): boolean {
  if (!ready || !socket) return false
  socket.send(JSON.stringify(message))
  return true
}

function run(step: () => Promise<void>): Promise<void> {
  queue = queue.then(step).catch((err: unknown) => log.warn({ event: 'cloud.events_failed', error: messageOf(err) }))
  return queue
}

function refusedOnce(ws: string): void {
  if (!socket || !roomKeys.room(ws)?.workspace.key || doubted.has(ws)) return
  doubted.add(ws)
  setTimeout(() => void run(async () => {
    doubted.delete(ws)
    if (!socket || !roomKeys.room(ws)) return
    if ((await roomKeys.refresh({ ws })).gone) await cloudEvents.drop({ ws, why: 'removed' })
  }), REFUSED_AGAIN_MS).unref()
}

async function refreshKeys(ws: string): Promise<void> {
  if (!roomKeys.room(ws)) return
  const before = roomKeys.members(ws)
  const { changed: moved, gone: out } = await roomKeys.refresh({ ws })
  const list = roomKeys.members(ws)
  const me = await keysService.deviceKey()
  const home = ws === keysService.account()?.workspace.id
  if (out) return home ? checkRemoved() : refusedOnce(ws)
  if (home && list && !list.members.some((member) => member.devices.includes(me))) return removedNow(ws)
  if (list) presence.members({ ws, emails: list.members.map((member) => member.email) })
  if (moved) emit({ name: 'cloud.changed', target: { type: 'cloud', id: ws } })
  if (moved && roomKeys.roleIn(ws) === 'owner' && droppedByOthers({ before, after: list, email: keysService.account()?.email })) void rotate?.(ws)
}

function droppedByOthers({ before, after, email }: { before: MemberListBody | null | undefined; after: MemberListBody | null | undefined; email: string | undefined }): boolean {
  const kept = new Set(after?.members.flatMap((member) => member.devices) ?? [])
  return Boolean(after && before?.members.some((member) => member.email !== email && member.devices.some((device) => !kept.has(device))))
}

async function refreshName(ws: string): Promise<void> {
  const view = Named.safeParse((await recordsService.get({ collection: 'workspace', workspace: ws, id: ws }))?.value).data
  const before = JSON.stringify(names.get(ws) ?? null)
  names.set(ws, { name: view?.name ?? null, site: view?.site ? siteHost(view.site) : null })
  if (JSON.stringify(names.get(ws)) !== before) emit({ name: 'cloud.changed', target: { type: 'cloud', id: ws } })
}

async function refreshRequests(ws: string): Promise<void> {
  const before = JSON.stringify(requests.get(ws) ?? [])
  const asked = await cloud.team(ws).requests()
  requests.set(ws, asked.filter((each) => each.asked).map((each) => ({ device: each.id, email: each.email, at: each.at, name: each.name, os: each.os, server: each.server, checked: Boolean(each.commit), reviewed: each.reviewed, faces: each.commit && each.nonce && commitOf({ device: each.id, nonce: each.nonce }) === each.commit ? facesOf({ device: each.id, nonce: each.nonce }) : null, location: each.location, newCountry: each.newCountry })))
  if (JSON.stringify(requests.get(ws)) !== before) emit({ name: 'cloud.changed', target: { type: 'cloud', id: ws } })
}

async function checkRemoved(): Promise<void> {
  const home = keysService.account()?.workspace.id
  if (!home) return
  const status = await cloud.team(home).lists().then(() => 200, (error: unknown) => error instanceof CloudError ? error.status : 0)
  if (status !== 403 && status !== 410) return
  await removedNow(home)
}

async function removedNow(home: string): Promise<void> {
  cloudEvents.stop()
  await keysService.removedHere()
  emit({ name: 'cloud.changed', target: { type: 'cloud', id: home } })
}

function beatBind({ ws, from }: { ws: string; from: string }): string {
  return `beat/${ws}/${from}`
}

function defaultName(ws: string): string {
  const owner = roomKeys.members(ws)?.members.find((member) => member.role === 'owner')?.email ?? ''
  const first = (owner.split('@')[0] ?? '').split(/[._+-]/)[0] ?? ''
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}’s team`
}
