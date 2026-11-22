import { createHash } from 'node:crypto'
import ReconnectingWebSocket from 'partysocket/ws'
import * as z from 'zod/mini'
import { checkProof, CloudWorkspace, DeleteNotice, DeviceRequest, parseJson, Record, signProof, siteHost, type Backup, type SetHere } from '@openhut/common/cloud/cloud.ts'
import { anchorOf, bodyOf, newUntil } from '@openhut/common/cloud/member-list.ts'
import { FileValue, openRecord, sealRecord, SYNCED, type AgentValue, type Opened, type Synced } from '@openhut/common/cloud/record.ts'
import { askCommit, fromBase64, newKey, readHeader, slot, toBase64 } from '@openhut/common/vault/vault.ts'
import { agentService } from '../agents/agent-service.ts'
import { cloud } from '../platform/cloud.ts'
import { db } from '../platform/db.ts'
import { emit, listen, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { keysService } from './keys-service.ts'
import { presence } from './presence.ts'
import { roomKeys, type Call } from './room-keys.ts'
import { forgetUpload } from './sync-files.ts'
import { syncKinds, type Context, type Local } from './sync-kinds.ts'
import { DELETED, DROPPED, SEQ, droppedSince, hashItem, rowKey, rowsById, saveRow, seqName, seqOf, type Row } from './sync-rows.ts'

const THROTTLE_MS = 300
const RETRY_MS = 1000
const RETRY_MAX_MS = 60_000
const HEAD_MS = 2000
const HEAD = 'head'
const KEPT = [401, 409, 429]
const TOMBSTONED: Synced[] = ['agent', 'message', 'connection']
const FIRST: Synced[] = ['connection', 'setting', 'agent']
const IDLE: Backup = { state: 'idle', done: 0, total: 0, current: null, at: null, agent: null, problem: null }
const KINDS_OF: [RegExp, Synced[]][] = [
  [/^agent\./, ['agent', 'message', 'memory', 'file']],
  [/^(setting|provider|admin)\./, ['setting']],
  [/^thread\.streamed$/, ['message']],
  [/^thread\./, ['message', 'file', 'memory']],
  [/^memory\.updated$/, ['memory']],
  [/^connection\./, ['connection']],
]
const Page = z.object({ data: z.array(Record), hasMore: z.boolean() })
const Requests = z.object({ data: z.array(DeviceRequest) })
const Gone = z.object({ deleted: DeleteNotice })
const Newer = z.object({ data: z.array(z.unknown()) })
const NAME = 'cloud_name'
const CHANGED = 'Someone changed this workspace a moment ago. Try again.'
const GONE = [4001, 4003, 4010]
const Missing = z.object({ error: z.object({ param: z.literal('file') }) })
const Message = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }), z.object({ type: z.literal('members') }), z.object({ type: z.literal('letter') }), z.object({ type: z.literal('workspace') }), z.object({ type: z.literal('record'), record: Record }),
  z.object({ type: z.literal('request') }), z.object({ type: z.literal('deleted') }),
  z.object({ type: z.literal('here'), from: z.string(), at: z.number(), body: z.string() }), z.object({ type: z.literal('gone'), from: z.string() }),
])

type Item = Local & { id: string }
type Sent = 'sent' | 'later' | 'refused'
type State = {
  ws: string; home: boolean; call: Call; socket: ReconnectingWebSocket | undefined; ready: boolean; timer: NodeJS.Timeout | undefined; headTimer: NodeJS.Timeout | undefined; keyTimer?: NodeJS.Timeout; failures: number
  wanted: [string, number][] | null; refused: Map<string, { kind: Synced; hash: string; name: string }>; dirty: Set<Synced>; backup: Backup; name: string | null; site: string | null
  requests: DeviceRequest[]; leaving?: boolean; log: { seq: number; hash: string }; echo: Map<string, number>
}
export type Gone = { name: string; why: 'removed' | 'deleted' }

let queue: Promise<void> = Promise.resolve()
const states = new Map<string, State>()
const backup: Backup = { ...IDLE }
const gone: Gone[] = []

presence.wire({
  rooms: () => [...states.values()].filter((s) => s.ready).map((s) => s.ws),
  roomOf: async (agent) => {
    const row = await db.selectFrom('agent').select(['workspace', 'shared']).where('id', '=', agent).executeTakeFirst()
    const ws = row?.shared ? row.workspace ?? keysService.account()?.workspace.id : undefined
    return ws && states.has(ws) ? ws : null
  },
  context: async (ws) => {
    const s = states.get(ws)
    const ctx = s?.ready ? await contextOf(s) : null
    const list = roomKeys.room(ws)?.list
    if (!s || !ctx || !list) return null
    return { workspace: ws, key: ctx.key, version: ctx.version, keys: ctx.keys, me: toBase64(ctx.me.publicKey), members: ctx.members, email: ctx.email, seq: s.log.seq, log: s.log.hash, list: bodyOf(list)?.version ?? 0, listHash: await anchorOf(list) }
  },
  send: ({ ws, text }) => {
    const s = states.get(ws)
    if (!s?.ready || !s.socket) return false
    s.socket.send(text)
    return true
  },
  catchUp: (ws) => {
    const s = states.get(ws)
    if (s?.ready) void run(async () => {
      await roomKeys.refresh({ ws, call: s.call })
      await catchUp(s)
    })
  },
})

listen((event) => {
  const kinds = KINDS_OF.find(([pattern]) => pattern.test(event.name))?.[1]
  if (kinds) syncService.send(kinds)
})

export const syncService = {
  connect(): void {
    const account = keysService.account()
    if (!account || !keysService.session()) return
    for (const room of roomKeys.rooms()) if (!states.has(room.workspace.id)) open(roomKeys.isOwn(room.workspace.id), room.workspace.id)
  },

  disconnect(): void {
    presence.forget()
    for (const s of states.values()) {
      s.socket?.close()
      clearTimeout(s.timer)
      clearTimeout(s.keyTimer)
      clearTimeout(s.headTimer)
    }
    states.clear()
  },

  async reset({ restoring }: { restoring: boolean }): Promise<void> {
    syncService.disconnect()
    await run(async () => {
      await db.deleteFrom('cloud_record').execute()
      await db.deleteFrom('install_setting').where('name', 'like', `${SEQ}%`).execute()
    })
    Object.assign(backup, IDLE, { state: restoring ? 'restoring' : 'idle' })
  },

  ready: (): boolean => homeState()?.ready ?? false,

  send(kinds: readonly Synced[] = SYNCED): void {
    for (const s of states.values()) send(s, kinds)
  },

  status: (): Backup => {
    const stuck = homeState()?.refused.values().next().value
    return { ...backup, problem: backup.problem ?? (stuck ? `${stuck.name} can’t be backed up. OpenHut tries again when it changes.` : null) }
  },

  name: (ws: string): string => states.get(ws)?.name ?? defaultName(ws),

  site: (ws: string): string | null => states.get(ws)?.site ?? null,

  async refreshName(ws: string): Promise<void> {
    const s = states.get(ws)
    if (s) await named(s)
  },

  waiting: (ws: string): boolean => !roomKeys.room(ws)?.workspace.key,

  requests: (ws: string): State['requests'] => states.get(ws)?.requests ?? [],

  gone: (): Gone[] => gone,

  async refreshRequests(ws: string): Promise<void> {
    const s = states.get(ws)
    if (s) await asked(s)
  },

  refreshTeams(): void {
    for (const s of states.values()) if (!s.home) void run(() => roomKeys.refresh({ ws: s.ws, call: s.call }).then(() => undefined))
  },

  async change({ ws, emails, devices, rotate = false }: { ws: string; emails?: string[]; devices?: string[]; rotate?: boolean }): Promise<void> {
    const { list, room: next, letters } = await roomKeys.teamChange({ ws, emails, devices, rotate })
    const token = await keysService.token()
    const leaving = Boolean(emails?.includes(keysService.account()?.email ?? ''))
    const outgoing = letters.map((each) => ({ ...each, workspace: ws }))
    if (rotate) await roomKeys.setRotating({ room: next, letters: outgoing })
    syncService.leaving({ ws, on: leaving })
    const put = await cloud.room({ method: 'PUT', workspace: ws, path: '/members', token, body: list }).catch(() => ({ status: 0 }))
    if (put.status !== 200) {
      syncService.leaving({ ws, on: false })
      if (rotate && (put.status === 403 || put.status === 409)) await roomKeys.setRotating({ ws })
      throw await refusal({ ws, status: put.status })
    }
    if (leaving) return drop({ ws, why: null })
    if (!rotate) return void await roomKeys.advance({ lists: [list], ws })
    await roomKeys.setRoom(next)
    await roomKeys.post(outgoing)
  },

  drop: (ws: string): Promise<void> => drop({ ws, why: null }),

  leaving({ ws, on }: { ws: string; on: boolean }): void {
    const s = states.get(ws)
    if (s) s.leaving = on
  },

  settled: (): Promise<void> => queue,

  here: (next: SetHere): Promise<void> => presence.set(next),

  presence: () => presence.view(),
}

function defaultName(ws: string): string {
  const owner = roomKeys.members(ws)?.members.find((member) => member.role === 'owner')?.email ?? ''
  const first = (owner.split('@')[0] ?? '').split(/[._+-]/)[0] ?? ''
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}’s workspace`
}

function homeState(): State | undefined {
  const home = keysService.account()?.workspace.id
  return home ? states.get(home) : undefined
}

function open(home: boolean, ws: string): void {
  const s: State = { ws, home, call: (input) => room(s, input), socket: undefined, ready: false, timer: undefined, headTimer: undefined, failures: 0, wanted: null, refused: new Map(), dirty: new Set(), name: null, site: null, requests: [], log: { seq: 0, hash: '' }, echo: new Map(), backup: home ? backup : { ...backup, state: 'idle', at: null, problem: null } }
  states.set(ws, s)
  const socket = new ReconnectingWebSocket(cloud.roomUrl(ws), [], { WebSocket: globalThis.WebSocket })
  s.socket = socket
  socket.addEventListener('open', () => {
    keysService.token().then((token) => socket.send(JSON.stringify({ type: 'hello', token })), (err: unknown) => log.warn({ event: 'cloud.refresh_failed', error: messageOf(err) }))
  })
  socket.addEventListener('message', (event) => heard(s, String(event.data)))
  socket.addEventListener('close', (event) => {
    s.ready = false
    presence.closed(ws)
    if (GONE.includes(event.code)) void run(() => checkRemoved(s))
  })
}

function send(s: State, kinds: readonly Synced[] = SYNCED): void {
  for (const kind of kinds) s.dirty.add(kind)
  if (!s.timer) schedule({ s, ms: THROTTLE_MS })
}

function schedule({ s, ms }: { s: State; ms: number }): void {
  if (!s.socket) return
  clearTimeout(s.timer)
  s.timer = setTimeout(() => {
    s.timer = undefined
    void run(() => flush(s))
  }, ms)
}

function heard(s: State, text: string): void {
  const message = Message.safeParse(parseJson(text)).data
  if (message?.type === 'here') void presence.heard({ ws: s.ws, from: message.from, at: message.at, body: message.body })
  if (message?.type === 'gone') presence.gone({ ws: s.ws, from: message.from })
  if (message?.type === 'ready') {
    s.ready = true
    presence.ready(s.ws)
    void run(async () => {
      await roomKeys.refresh({ ws: s.ws, call: s.call })
      await named(s)
      await asked(s)
      await catchUp(s, await droppedSince({ s }))
      await roomKeys.post()
    })
    send(s)
  }
  if (message?.type === 'workspace') void run(() => named(s))
  if (message?.type === 'request') void run(() => asked(s))
  if (message?.type === 'deleted' && !s.leaving) void run(() => checkRemoved(s))
  if (message?.type === 'members' || message?.type === 'letter') void run(async () => {
    const keyless = syncService.waiting(s.ws)
    const { changed } = await roomKeys.refresh({ ws: s.ws, call: s.call })
    const list = roomKeys.members(s.ws)
    if (message.type === 'members' && list) presence.members({ ws: s.ws, emails: list.members.map((member) => member.email) })
    if (message.type === 'members') await asked(s)
    if (keyless && !syncService.waiting(s.ws)) await named(s).then(() => catchUp(s))
    if (changed) send(s, keyless ? SYNCED : ['connection'])
  })
  if (message?.type === 'record') void run(async () => message.record.seq === await seqOf(s) + 1 ? applyAll(s, [message.record]) : catchUp(s))
}

function run(step: () => Promise<void>): Promise<void> {
  queue = queue.then(step).catch((err: unknown) => log.warn({ event: 'cloud.sync_failed', error: messageOf(err) }))
  return queue
}

async function named(s: State): Promise<void> {
  const reply = await room(s, { method: 'GET', path: '' })
  const view = CloudWorkspace.safeParse(reply.json).data
  const before = [s.name, s.site].join('|')
  s.name = await roomKeys.openMeta({ ws: s.ws, field: 'name', locked: view?.name }) ?? s.name
  const site = view && (view.site ? await roomKeys.openMeta({ ws: s.ws, field: 'site', locked: view.site }) : '')
  if (typeof site === 'string') s.site = siteHost(site)
  if ([s.name, s.site].join('|') !== before) emit({ name: 'cloud.changed', target: { type: 'cloud', id: s.ws } })
  if (s.name) await db.insertInto('install_setting').values({ name: `${NAME}:${s.ws}`, value: s.name }).onConflict((oc) => oc.column('name').doUpdateSet({ value: s.name ?? '' })).execute()
}

async function catchUp(s: State, from: number | null = null): Promise<void> {
  if (!await contextOf(s)) return
  try {
    const records: Record[] = []
    for (let after = Math.min(from ?? Infinity, await seqOf(s)), more = true; more;) {
      const page = Page.safeParse((await room(s, { method: 'GET', path: `/records?after=${after}` })).json)
      if (!page.success) throw new HttpError(502, 'OpenHut Cloud sent a backup this computer can’t read. Update OpenHut and try again.')
      records.push(...page.data.data)
      more = page.data.hasMore && page.data.data.length > 0
      after = page.data.data.at(-1)?.seq ?? after
    }
    await applyAll(s, records)
  } finally {
    if (s.backup.state === 'restoring') Object.assign(s.backup, { state: 'idle', at: new Date().toISOString() })
  }
}

async function applyAll(s: State, all: Record[]): Promise<void> {
  let ctx = await contextOf(s)
  if (!ctx) return
  const rows = await rowsById(s)
  const opened: [Record, Opened][] = []
  const dropped: [Record, Opened | null][] = []
  let records = all
  for (const [index, record] of all.entries()) {
    const row = rows.get(record.id)
    if ((row?.ver ?? 0) > record.ver || (row?.ver === record.ver && row.hash !== DROPPED)) continue
    const newer = () => !ctx || (readHeader(fromBase64(record.body))?.version ?? 0) > ctx.version
    if (newer()) {
      await roomKeys.refresh({ ws: s.ws, call: s.call })
      ctx = await contextOf(s)
    }
    if (!ctx || newer()) {
      records = all.slice(0, index)
      log.warn({ event: 'cloud.record_waiting', record: record.id, seq: record.seq })
      s.keyTimer ??= setTimeout(() => void run(async () => { s.keyTimer = undefined; await catchUp(s) }), RETRY_MS * 5)
      break
    }
    const open = await openSafely({ s, record, ctx })
    if (open) opened.push([record, open])
    else dropped.push([record, null])
  }
  const after = await contextOf(s) ?? ctx
  if (!after) return
  opened.sort(([, a], [, b]) => FIRST.indexOf(b.kind) - FIRST.indexOf(a.kind))
  const restoring = s.backup.state === 'restoring'
  if (restoring) Object.assign(s.backup, { done: 0, total: opened.filter(([, open]) => open.kind === 'agent' && open.value).length })
  const seqs = new Map([...rows.values()].filter((row) => row.kind === 'message').map((row) => [row.ref, row.seq]))
  const failed = new Set<string>()
  const applied: [Record, Opened][] = []
  for (const [record, open] of opened) {
    if (!open.hidden && !(await syncKinds.allowed({ open, ctx: after, row: rows.get(record.id) }))) {
      dropped.push([record, open])
      continue
    }
    if (open.kind === 'agent' && open.value) s.backup.current = open.value.name
    if (open.kind === 'file' && !open.hidden) await saveRow(s, { ...rowOf({ record, open }), hash: DROPPED })
    const later = (ref: string) => (seqs.get(ref) ?? Infinity) > record.seq
    await (open.hidden ? syncKinds.hide({ open, ctx: after }) : syncKinds.apply({ open, ctx: after, later })).catch((err: unknown) => {
      failed.add(record.id)
      log.warn({ event: 'cloud.apply_failed', record: record.id, error: messageOf(err) })
    })
    if (open.kind === 'message') seqs.set(open.ref, record.seq)
    applied.push([record, open])
    if (restoring && open.kind === 'agent' && open.value) Object.assign(s.backup, { done: s.backup.done + 1, agent: open.ref })
  }
  const connections = applied.some(([, open]) => open.kind === 'connection') ? new Map((await localsOf({ s, kind: 'connection', ctx: after }).catch(() => null) ?? []).map((each) => [each.id, each])) : undefined
  for (const [record, open] of applied.filter(([, each]) => each.kind !== 'file' || each.hidden)) {
    const value = open.kind === 'connection' ? connections?.get(record.id) ?? { value: null } : { value: open.value, owner: open.owner }
    const hash = failed.has(record.id) ? rows.get(record.id)?.hash ?? DELETED : hashItem(value)
    await saveRow(s, { ...rowOf({ record, open }), hash: open.hidden ? DELETED : hash })
  }
  for (const [record, open] of dropped) {
    const row = rows.get(record.id)
    log.warn({ event: 'cloud.record_dropped', record: record.id, seq: record.seq })
    await saveRow(s, { id: record.id, kind: row?.kind ?? DROPPED, ref: row?.ref ?? '', ver: record.ver, seq: record.seq, hash: DROPPED, signer: row?.signer ?? null, agent_id: row?.agent_id ?? (open && rowOf({ record, open }).agent_id) })
  }
  if (dropped.length) send(s)
  const head = opened.map(([, open]) => open).find((open) => open.kind === 'head')
  if ((restoring || s.wanted) && head?.kind === 'head' && head.value) s.wanted = head.value.records
  if (s.wanted) await checkHead(s, s.wanted)
  const last = records.at(-1)
  if (last && last.seq > await seqOf(s)) await db.insertInto('install_setting').values({ name: seqName(s), value: String(last.seq) }).onConflict((oc) => oc.column('name').doUpdateSet({ value: String(last.seq) })).execute()
  for (const record of records) if (s.echo.has(record.id)) s.echo.set(record.id, Math.max(s.echo.get(record.id) ?? 0, record.ver))
  s.log = { seq: await seqOf(s), hash: logHash({ s, rows: await rowsById(s) }) }
  const retry = await droppedSince({ s, agents: applied.flatMap(([, open]) => open.kind === 'agent' && open.value ? [open.ref] : []) })
  if (retry !== null) await catchUp(s, retry)
}

function logHash({ s, rows }: { s: State; rows: Map<string, Row> }): string {
  const lines: string[] = []
  for (const [id, row] of rows) {
    const seen = s.echo.get(id)
    if (seen !== undefined && seen >= row.ver) s.echo.delete(id)
    const ver = seen ?? row.ver
    if (ver > 0) lines.push(`${id}:${ver}`)
  }
  return createHash('sha256').update(lines.sort().join('\n')).digest('base64url')
}

function rowOf({ record, open }: { record: Record; open: Opened }): Omit<Row, 'hash'> {
  const agentId = open.value && 'agentId' in open.value ? open.value.agentId : null
  return { id: record.id, kind: open.kind, ref: open.ref, ver: record.ver, seq: record.seq, signer: open.by, agent_id: agentId }
}

async function openSafely({ s, record, ctx }: { s: State; record: Record; ctx: Context }): Promise<Opened | null> {
  const open = () => openRecord({ workspace: ctx.workspace, keys: ctx.keys, record, members: roomKeys.members(s.ws)?.members ?? [], own: ctx.own && { key: ctx.own, email: ctx.email } })
  const opened = await open() ?? ((await roomKeys.refresh({ ws: s.ws, call: s.call })).changed ? await open() : null)
  return opened && record.id === await slot({ key: ctx.slotKey, path: `${opened.kind}/${opened.ref}` }) ? opened : null
}

async function checkHead(s: State, records: [string, number][]): Promise<void> {
  const rows = await rowsById(s)
  const missing = records.filter(([id, ver]) => (rows.get(id)?.ver ?? 0) < ver).length
  s.backup.problem = missing ? `${missing} of ${records.length} agents, chats and settings didn’t come back. Open OpenHut on your other computer so it backs them up again.` : null
  if (!missing) s.wanted = null
}

async function flush(s: State): Promise<void> {
  if (s.ready && await roomKeys.rekey({ ws: s.ws, call: s.call })) return schedule({ s, ms: RETRY_MS * 2 })
  const ctx = await contextOf(s)
  if (!s.ready || !ctx) return
  const kinds = SYNCED.filter((kind) => s.dirty.delete(kind))
  const changed = await unsent({ s, kinds, ctx })
  const { backup: progress, refused } = s
  if (!changed.length) {
    if (progress.state === 'failed' && !refused.size) Object.assign(progress, { state: 'idle', at: new Date().toISOString() })
    return
  }
  const stuck = [...refused.keys()].filter((id) => !changed.some((each) => each.id === id)).length
  Object.assign(progress, { state: 'backing_up', done: 0, total: changed.length + stuck, current: null })
  const later = new Set<string>()
  try {
    for (const item of changed) {
      const sent = await put({ s, item, ver: ((await rowsById(s)).get(item.id)?.ver ?? 0) + 1, ctx })
      if (sent === 'later') later.add(item.id)
      if (sent === 'refused') refused.set(item.id, { kind: item.kind, hash: hashItem(item), name: nameOf(item) })
      else progress.done++
      if (sent === 'sent') refused.delete(item.id)
    }
  } catch (err) {
    log.warn({ event: 'cloud.backup_failed', error: messageOf(err) })
  }
  const tried = new Set(changed.map((each) => each.id).filter((id) => !later.has(id)))
  if ((await unsent({ s, kinds, ctx })).some((each) => tried.has(each.id))) {
    for (const kind of kinds) s.dirty.add(kind)
    progress.state = 'failed'
    s.failures++
    return schedule({ s, ms: Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (s.failures - 1)) })
  }
  s.failures = 0
  clearTimeout(s.headTimer)
  if (changed.some((each) => each.kind !== 'message')) await writeHead(s)
  else s.headTimer = setTimeout(() => void run(() => writeHead(s)), HEAD_MS)
  Object.assign(progress, refused.size ? { state: 'failed' } : { state: 'idle', at: new Date().toISOString() })
}

function nameOf(item: Item): string {
  return item.kind === 'agent' ? (item.value as AgentValue).name : `A ${item.kind}`
}

async function unsent({ s, kinds, ctx }: { s: State; kinds: Synced[]; ctx: Context }): Promise<Item[]> {
  const rows = await rowsById(s)
  const me = toBase64(ctx.me.publicKey)
  const runners = new Map(kinds.includes('message') || kinds.includes('file') ? (await agentService.synced({ workspace: ctx.home ? null : ctx.workspace, owner: ctx.email })).map((agent) => [agent.id, agent.runsOn]) : [])
  const changed: Item[] = []
  for (const kind of kinds) {
    const mine = await localsOf({ s, kind, ctx }).catch((err: unknown) => { log.warn({ event: 'cloud.locals_failed', kind, error: messageOf(err) }) })
    if (!mine) continue
    const ids = new Set(mine.map((each) => each.id))
    for (const [id, each] of s.refused) if (each.kind === kind && !ids.has(id)) s.refused.delete(id)
    const gone: Item[] = TOMBSTONED.includes(kind) ? [...rows.values()].filter((row) => row.kind === kind && row.hash !== DELETED && (row.hash !== DROPPED || row.signer === me) && !ids.has(row.id)).map((row) => ({ id: row.id, kind, ref: row.ref, value: null, agentId: row.agent_id ?? undefined })) : []
    for (const each of [...mine, ...gone]) {
      const row = rows.get(each.id)
      const runsHere = each.agentId !== undefined && runners.get(each.agentId) === me
      if ((kind === 'message' || kind === 'file') && !writable({ item: each, row, me, runsHere, live: each.agentId === undefined || runners.has(each.agentId) })) continue
      const resign = kind === 'message' && each.assistant && runsHere && !!row && row.signer !== me
      if (resign || ![row?.hash, s.refused.get(each.id)?.hash].includes(hashItem(each))) changed.push(each)
    }
  }
  return changed
}

function writable({ item, row, me, runsHere, live }: { item: Item; row: Row | undefined; me: string; runsHere: boolean; live: boolean }): boolean {
  if (item.value === null) return live && (!row?.signer || row.signer === me || runsHere)
  if (item.assistant) return runsHere
  return !row?.signer || row.signer === me || (item.kind === 'file' && runsHere)
}

async function writeHead(s: State): Promise<void> {
  const ctx = await contextOf(s)
  if (!s.ready || !ctx) return
  const rows = await rowsById(s)
  const id = await slot({ key: ctx.slotKey, path: `${HEAD}/${HEAD}` })
  const records = [...rows.values()].filter((row) => row.kind !== HEAD && row.hash !== DELETED && row.hash !== DROPPED).map((row): [string, number] => [row.id, row.ver])
  await put({ s, item: { id, kind: HEAD, ref: HEAD, value: { records } }, ver: (rows.get(id)?.ver ?? 0) + 1, ctx }).catch((err: unknown) => log.warn({ event: 'cloud.head_failed', error: messageOf(err) }))
}

async function put({ s, item, ver, ctx }: { s: State; item: Item; ver: number; ctx: Context }): Promise<Sent> {
  if (item.owner && item.value !== null && (!ctx.own || item.owner !== ctx.email)) return 'later'
  const hash = hashItem(item)
  const value = item.value === null || !item.wire ? item.value : await item.wire()
  if (value === undefined) return 'later'
  const own = item.owner && ctx.own && item.value !== null ? { key: ctx.own, email: item.owner } : undefined
  const sealed = await sealRecord({ workspace: ctx.workspace, key: ctx.key, version: ctx.version, signer: ctx.me, id: item.id, ver, kind: item.kind, ref: item.ref, value, own })
  if (!sealed) return 'refused'
  const file = item.kind === 'file' ? FileValue.safeParse(value).data?.blob : undefined
  const reply = await room(s, { method: 'PUT', path: `/records/${item.id}`, body: { ...sealed, file } })
  if (reply.status === 409 && file && Missing.safeParse(reply.json).success) {
    forgetUpload(file)
    await item.wire?.()
    return 'later'
  }
  if (reply.status === 409) {
    await catchUp(s)
    return 'sent'
  }
  if (reply.status >= 400 && reply.status < 500 && !KEPT.includes(reply.status)) return 'refused'
  if (reply.status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t save a backup. OpenHut tries again.')
  if (!s.echo.has(item.id)) s.echo.set(item.id, ver - 1)
  await saveRow(s, { id: item.id, kind: item.kind, ref: item.ref, ver, seq: Record.safeParse(reply.json).data?.seq ?? 0, hash, signer: toBase64(ctx.me.publicKey), agent_id: item.agentId ?? null })
  return 'sent'
}

async function localsOf({ s, kind, ctx }: { s: State; kind: Synced; ctx: Context }): Promise<Item[] | null> {
  const items = await syncKinds.locals({ kind, ctx })
  return items && Promise.all(items.map(async (item) => ({ ...item, id: await slot({ key: ctx.slotKey, path: `${item.kind}/${item.ref}` }) })))
}

async function contextOf(s: State): Promise<Context | null> {
  const account = keysService.account()
  const found = roomKeys.room(s.ws)
  if (!account || !found?.workspace.key) return null
  const members = roomKeys.members(s.ws)?.members ?? []
  const signer = await keysService.accountDeviceKey()
  const runtimes = s.home ? (members.find((member) => member.email === account.email)?.devices ?? []).filter((device) => device !== signer) : []
  const { id: workspace, key, version, old, slot: slotKey } = found.workspace
  const role = roomKeys.roleIn(s.ws)
  const keys = Object.fromEntries([...Object.entries(old ?? {}), [String(version), key]].map(([each, value]) => [Number(each), fromBase64(value)]))
  return {
    workspace, home: s.home, key: fromBase64(key), version, keys, slotKey: fromBase64(slotKey ?? key), me: await keysService.device(), members, runtimes, own: await roomKeys.own(s.ws), email: account.email,
    admin: Boolean(role && role !== 'member'),
    putFile: async ({ hash, body }) => cloud.putFile({ workspace, hash, body, token: await keysService.token() }),
    getFile: async (hash) => cloud.getFile({ workspace, hash, token: await keysService.token() }),
    again: () => send(s, ['file']),
    landed: ({ kind, ref, value, owner }) => void run(async () => {
      await db.updateTable('cloud_record').set({ hash: hashItem({ value, owner }) }).where('workspace', '=', rowKey(s)).where('id', '=', await slot({ key: fromBase64(slotKey ?? key), path: `${kind}/${ref}` })).execute()
    }),
  }
}

async function checkRemoved(s: State): Promise<void> {
  if (!keysService.account() || !states.has(s.ws) || s.leaving) return
  const { status, json } = await room(s, { method: 'GET', path: '/member-lists?after=0' })
  const deleted = status === 410 && await signedDelete({ ws: s.ws, json })
  if (status !== 403 && !deleted) {
    if (status === 404 || status === 410) log.warn({ event: 'cloud.delete_unsigned', workspace: s.ws, status })
    return
  }
  if (!roomKeys.isOwn(s.ws)) return drop({ ws: s.ws, why: deleted ? 'deleted' : 'removed' })
  syncService.disconnect()
  if (deleted) return keysService.forgetHere()
  await keysService.removedHere()
}

async function signedDelete({ ws, json }: { ws: string; json: unknown }): Promise<boolean> {
  const notice = Gone.safeParse(json).data?.deleted
  const body = roomKeys.members(ws)
  const signer = notice && body?.members.find((member) => member.devices.includes(notice.by))
  if (!notice || !body || !signer || signer.role === 'member' || signer.kit === notice.by || body.runtimes?.includes(notice.by) || newUntil(body, notice.by) > notice.signedAt) return false
  return checkProof({ device: notice.by, proof: 'delete', parts: [ws, String(notice.signedAt)], signature: notice.signature })
}

export async function refusal({ ws, status }: { ws: string; status: number }): Promise<HttpError> {
  if (status === 409) return new HttpError(409, CHANGED)
  if (status !== 403) return new HttpError(502, 'OpenHut Cloud couldn’t save the change. Try again.')
  const newer = await cloud.room({ method: 'GET', workspace: ws, path: `/member-lists?after=${roomKeys.members(ws)?.version ?? 0}`, token: await keysService.token() }).catch(() => null)
  if (newer?.status === 403 || (Newer.safeParse(newer?.json).data?.data.length ?? 0) > 0) return new HttpError(409, CHANGED)
  return new HttpError(403, 'OpenHut Cloud couldn’t save the change. Try again.')
}

async function drop({ ws, why }: { ws: string; why: Gone['why'] | null }): Promise<void> {
  const s = states.get(ws)
  const own = roomKeys.isOwn(ws)
  const saved = await db.selectFrom('install_setting').select('value').where('name', '=', `${NAME}:${ws}`).executeTakeFirst()
  if (why) gone.push({ name: s?.name ?? saved?.value ?? defaultName(ws), why })
  s?.socket?.close()
  for (const timer of [s?.timer, s?.keyTimer, s?.headTimer]) clearTimeout(timer)
  states.delete(ws)
  presence.closed(ws)
  await roomKeys.dropRoom(ws)
  if (!own) await (why === 'removed' ? agentService.keepWorkspace(ws) : agentService.dropWorkspace(ws))
  await db.deleteFrom('cloud_record').where('workspace', '=', own ? '' : ws).execute()
  await db.deleteFrom('install_setting').where('name', 'in', [own ? SEQ : `${SEQ}:${ws}`, `${NAME}:${ws}`]).execute()
  if (!own) syncService.connect()
  emit({ name: 'cloud.changed', target: { type: 'cloud', id: ws } })
}

async function asked(s: State): Promise<void> {
  const before = JSON.stringify(s.requests)
  const found = Requests.safeParse((await room(s, { method: 'GET', path: '/requests' })).json).data?.data ?? []
  const admin = roomKeys.roleIn(s.ws) !== 'member' && !syncService.waiting(s.ws)
  const fresh = admin ? found.filter((each) => !each.nonce && each.commit) : []
  for (const each of fresh) {
    const nonce = toBase64(newKey(16))
    const me = await keysService.device()
    await room(s, { method: 'PUT', path: `/requests/${encodeURIComponent(each.device)}/nonce`, body: { nonce, by: toBase64(me.publicKey), signature: await signProof({ signer: me, proof: 'words', parts: [s.ws, each.device, each.commit ?? '', nonce] }) } })
  }
  const all = fresh.length ? Requests.safeParse((await room(s, { method: 'GET', path: '/requests' })).json).data?.data ?? [] : found
  s.requests = await Promise.all(all.map(async (each) => await wordsReady({ ws: s.ws, request: each }) ? each : { ...each, nonce: null, reveal: null }))
  if (JSON.stringify(s.requests) !== before) emit({ name: 'cloud.changed', target: { type: 'cloud', id: s.ws } })
}

async function wordsReady({ ws, request: { device, commit, nonce, reveal } }: { ws: string; request: DeviceRequest }): Promise<boolean> {
  const signer = nonce && roomKeys.members(ws)?.members.find((member) => member.devices.includes(nonce.by))
  if (!commit || !nonce || !reveal || !signer || signer.role === 'member') return false
  const opened = toBase64(await askCommit({ device: fromBase64(device), reveal: fromBase64(reveal) })) === commit
  return opened && checkProof({ device: nonce.by, proof: 'words', parts: [ws, device, commit, nonce.nonce], signature: nonce.signature })
}

async function room(s: State, { method, path, body }: { method: 'GET' | 'PUT' | 'POST' | 'DELETE'; path: string; body?: unknown }): Promise<{ status: number; json: unknown }> {
  if (!keysService.account()) throw new HttpError(409, 'Enable OpenHut Cloud first.')
  return cloud.room({ method, workspace: s.ws, path, token: await keysService.token(), body })
}
