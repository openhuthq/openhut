import { createHash } from 'node:crypto'
import ReconnectingWebSocket from 'partysocket/ws'
import * as z from 'zod/mini'
import { CloudWorkspace, Letter, MemberList, parseJson, Record, type Backup } from '@openhut/common/cloud/cloud.ts'
import { keyVersionOf } from '@openhut/common/cloud/member-list.ts'
import { openRecord, sealRecord, SYNCED, type Opened, type Synced } from '@openhut/common/cloud/record.ts'
import { fromBase64, readHeader, slot } from '@openhut/common/vault/vault.ts'
import { cloud } from '../platform/cloud.ts'
import { db } from '../platform/db.ts'
import { listen, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { keysService } from './keys-service.ts'
import { syncKinds, type Context, type Local } from './sync-kinds.ts'

const THROTTLE_MS = 300
const RETRY_MS = 1000
const RETRY_MAX_MS = 60_000
const HEAD_MS = 2000
const HEAD = 'head'
const DELETED = 'deleted'
const SEQ = 'cloud_seq'
const HERE = process.platform === 'darwin' ? 'Mac' : 'computer'
const KEPT = [401, 409, 429]
const TOMBSTONED: Synced[] = ['agent', 'message', 'connection']
const FIRST: Synced[] = ['connection', 'setting', 'agent']
const KINDS_OF: [RegExp, Synced[]][] = [
  [/^agent\./, ['agent', 'message', 'memory', 'file']],
  [/^(setting|provider|admin)\./, ['setting']],
  [/^thread\.streamed$/, ['message']],
  [/^thread\./, ['message', 'file', 'memory']],
  [/^memory\.updated$/, ['memory']],
  [/^connection\./, ['connection']],
]
const Page = z.object({ data: z.array(Record), hasMore: z.boolean() })
const Lists = z.object({ data: z.array(MemberList) })
const Letters = z.object({ data: z.array(Letter) })
const Message = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }), z.object({ type: z.literal('members') }), z.object({ type: z.literal('letter') }), z.object({ type: z.literal('workspace') }), z.object({ type: z.literal('record'), record: Record }),
])

type Item = Local & { id: string }
type Row = Omit<Local, 'value' | 'wire' | 'owner'> & { id: string; ver: number; hash: string }
type Sent = 'sent' | 'later' | 'refused'
type State = {
  ws: string; home: boolean; socket: ReconnectingWebSocket | undefined; ready: boolean; timer: NodeJS.Timeout | undefined; headTimer: NodeJS.Timeout | undefined; keyTimer?: NodeJS.Timeout; failures: number
  wanted: [string, number][] | null; refused: Map<string, { kind: Synced; hash: string; name: string }>; dirty: Set<Synced>; backup: Backup; name: string | null
}

let queue: Promise<void> = Promise.resolve()
const states = new Map<string, State>()
const backup: Backup = { state: 'idle', done: 0, total: 0, current: null, at: null, agent: null, problem: null }

listen((event) => {
  const kinds = KINDS_OF.find(([pattern]) => pattern.test(event.name))?.[1]
  if (kinds) syncService.send(kinds)
})

export const syncService = {
  connect(): void {
    const account = keysService.account()
    if (!account || !keysService.session()) return
    for (const room of keysService.rooms()) if (!states.has(room.workspace.id)) open(room.workspace.id === account.workspace.id, room.workspace.id)
  },

  disconnect(): void {
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
    Object.assign(backup, { state: restoring ? 'restoring' : 'idle', done: 0, total: 0, current: null, at: null, agent: null, problem: null })
  },

  ready: (): boolean => homeState()?.ready ?? false,

  send(kinds: readonly Synced[] = SYNCED): void {
    for (const s of states.values()) send(s, kinds)
  },

  status: (): Backup => {
    const stuck = homeState()?.refused.values().next().value
    return { ...backup, problem: backup.problem ?? (stuck ? `${stuck.name} can’t be backed up: it doesn’t fit what OpenHut Cloud keeps.` : null) }
  },

  name: (ws: string): string | null => states.get(ws)?.name ?? null,

  async refreshName(ws: string): Promise<void> {
    const s = states.get(ws)
    if (s) await named(s)
  },

  waiting: (ws: string): boolean => !keysService.room(ws)?.workspace.key,

  settled: (): Promise<void> => queue,
}

function homeState(): State | undefined {
  const home = keysService.account()?.workspace.id
  return home ? states.get(home) : undefined
}

function open(home: boolean, ws: string): void {
  const s: State = { ws, home, socket: undefined, ready: false, timer: undefined, headTimer: undefined, failures: 0, wanted: null, refused: new Map(), dirty: new Set(), name: null, backup: home ? backup : { ...backup, state: 'idle', at: null, problem: null } }
  states.set(ws, s)
  const socket = new ReconnectingWebSocket(cloud.roomUrl(ws), [], { WebSocket: globalThis.WebSocket })
  s.socket = socket
  socket.addEventListener('open', () => {
    keysService.token().then((token) => socket.send(JSON.stringify({ type: 'hello', token })), (err: unknown) => log.warn({ event: 'cloud.refresh_failed', error: messageOf(err) }))
  })
  socket.addEventListener('message', (event) => heard(s, String(event.data)))
  socket.addEventListener('close', (event) => {
    s.ready = false
    if (home && (event.code === 4001 || event.code === 4003)) void run(() => checkRemoved(s))
  })
}

function send(s: State, kinds: readonly Synced[] = SYNCED): void {
  if (!s.socket) return
  for (const kind of kinds) s.dirty.add(kind)
  s.timer ??= setTimeout(() => {
    s.timer = undefined
    void run(() => flush(s))
  }, THROTTLE_MS)
}

function retry(s: State, ms: number): void {
  if (!s.socket) return
  clearTimeout(s.timer)
  s.timer = setTimeout(() => {
    s.timer = undefined
    void run(() => flush(s))
  }, ms)
}

function heard(s: State, text: string): void {
  const message = Message.safeParse(parseJson(text)).data
  if (message?.type === 'ready') {
    s.ready = true
    void run(async () => {
      await named(s)
      await refreshMembers(s)
      await rekey(s)
      await catchUp(s)
    })
    send(s)
  }
  if (message?.type === 'workspace') void run(() => named(s))
  if (message?.type === 'members' || message?.type === 'letter') void run(async () => {
    const changed = await refreshMembers(s)
    const keyless = syncService.waiting(s.ws)
    await rekey(s)
    if (keyless && !syncService.waiting(s.ws)) await catchUp(s)
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
  s.name = CloudWorkspace.safeParse(reply.json).data?.name ?? s.name
}

async function catchUp(s: State): Promise<void> {
  if (!await contextOf(s)) return
  try {
    const records: Record[] = []
    for (let after = await seqOf(s), more = true; more;) {
      const page = Page.safeParse((await room(s, { method: 'GET', path: `/records?after=${after}` })).json)
      if (!page.success) throw new HttpError(502, 'OpenHut Cloud sent records this computer can’t read.')
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
  let records = all
  for (const [index, record] of all.entries()) {
    if ((rows.get(record.id)?.ver ?? 0) >= record.ver) continue
    const newer = () => !ctx || (readHeader(fromBase64(record.body))?.version ?? 0) > ctx.version
    if (newer()) {
      await refreshMembers(s)
      await rekey(s)
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
    else log.warn({ event: 'cloud.record_dropped', record: record.id, seq: record.seq })
  }
  const after = await contextOf(s) ?? ctx
  if (!after) return
  opened.sort(([, a], [, b]) => FIRST.indexOf(b.kind) - FIRST.indexOf(a.kind))
  const restoring = s.backup.state === 'restoring'
  if (restoring) Object.assign(s.backup, { done: 0, total: opened.filter(([, open]) => open.kind === 'agent' && open.value).length })
  const expected = new Map<string, unknown>()
  for (const [record, open] of opened) {
    if (open.kind === 'agent' && open.value) s.backup.current = open.value.name
    const applied = open.hidden ? syncKinds.hide({ open, ctx: after }) : syncKinds.apply({ open, ctx: after })
    expected.set(record.id, await applied.catch((err: unknown) => log.warn({ event: 'cloud.apply_failed', record: record.id, error: messageOf(err) })))
    if (restoring && open.kind === 'agent' && open.value) Object.assign(s.backup, { done: s.backup.done + 1, agent: open.ref })
  }
  const locals = new Map<Synced, Map<string, Item>>()
  for (const kind of new Set(opened.map(([, open]) => open.kind))) {
    const mine = kind !== 'file' ? await localsOf({ s, kind, ctx: after }).catch(() => null) : null
    locals.set(kind, new Map((mine ?? []).map((each) => [each.id, each])))
  }
  for (const [record, open] of opened) {
    const local = open.kind === 'file' ? { value: expected.get(record.id) ?? null, owner: open.owner } : locals.get(open.kind)?.get(record.id)
    await saveRow(s, { id: record.id, kind: open.kind, ref: open.ref, ver: record.ver, hash: open.hidden ? DELETED : hashItem(local ?? { value: null }) })
  }
  const head = opened.map(([, open]) => open).find((open) => open.kind === 'head')
  if ((restoring || s.wanted) && head?.kind === 'head' && head.value) s.wanted = head.value.records
  if (s.wanted) await checkHead(s, s.wanted)
  const last = records.at(-1)
  if (last && last.seq > await seqOf(s)) await db.insertInto('install_setting').values({ name: seqName(s), value: String(last.seq) }).onConflict((oc) => oc.column('name').doUpdateSet({ value: String(last.seq) })).execute()
}

async function openSafely({ s, record, ctx }: { s: State; record: Record; ctx: Context }): Promise<Opened | null> {
  const open = () => openRecord({ workspace: ctx.workspace, keys: ctx.keys, record, members: keysService.members(s.ws)?.members ?? [], own: ctx.own && { key: ctx.own, email: ctx.email } })
  const opened = await open() ?? (await refreshMembers(s) ? await open() : null)
  return opened && record.id === await slot({ key: ctx.slotKey, path: `${opened.kind}/${opened.ref}` }) ? opened : null
}

async function checkHead(s: State, records: [string, number][]): Promise<void> {
  const rows = await rowsById(s)
  const missing = records.filter(([id, ver]) => (rows.get(id)?.ver ?? 0) < ver).length
  s.backup.problem = missing ? `${missing} of ${records.length} agents and settings didn’t come back. Open OpenHut on your other ${HERE} so it backs them up again.` : null
  if (!missing) s.wanted = null
}

async function flush(s: State): Promise<void> {
  if (s.ready && await rekey(s)) return retry(s, RETRY_MS * 2)
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
    return retry(s, Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (s.failures - 1)))
  }
  s.failures = 0
  clearTimeout(s.headTimer)
  if (changed.some((each) => each.kind !== 'message')) await writeHead(s)
  else s.headTimer = setTimeout(() => void run(() => writeHead(s)), HEAD_MS)
  Object.assign(progress, refused.size ? { state: 'failed' } : { state: 'idle', at: new Date().toISOString() })
}

function nameOf(item: Item): string {
  const name = item.kind === 'agent' && item.value && typeof item.value === 'object' && 'name' in item.value ? String(item.value.name) : ''
  return name || `A ${item.kind}`
}

async function unsent({ s, kinds, ctx }: { s: State; kinds: Synced[]; ctx: Context }): Promise<Item[]> {
  const rows = await rowsById(s)
  const changed: Item[] = []
  for (const kind of kinds) {
    const mine = await localsOf({ s, kind, ctx }).catch((err: unknown) => { log.warn({ event: 'cloud.locals_failed', kind, error: messageOf(err) }) })
    if (!mine) continue
    const ids = new Set(mine.map((each) => each.id))
    for (const [id, each] of s.refused) if (each.kind === kind && !ids.has(id)) s.refused.delete(id)
    const gone = TOMBSTONED.includes(kind) ? [...rows.values()].filter((row) => row.kind === kind && row.hash !== DELETED && !ids.has(row.id)).map((row) => ({ ...row, value: null })) : []
    changed.push(...[...mine, ...gone].filter((each) => ![rows.get(each.id)?.hash, s.refused.get(each.id)?.hash].includes(hashItem(each))))
  }
  return changed
}

async function writeHead(s: State): Promise<void> {
  const ctx = await contextOf(s)
  if (!s.ready || !ctx) return
  const rows = await rowsById(s)
  const id = await slot({ key: ctx.slotKey, path: `${HEAD}/${HEAD}` })
  const records = [...rows.values()].filter((row) => row.kind !== HEAD && row.hash !== DELETED).map((row): [string, number] => [row.id, row.ver])
  await put({ s, item: { id, kind: HEAD, ref: HEAD, value: { records } }, ver: (rows.get(id)?.ver ?? 0) + 1, ctx }).catch((err: unknown) => log.warn({ event: 'cloud.head_failed', error: messageOf(err) }))
}

async function put({ s, item, ver, ctx }: { s: State; item: Item; ver: number; ctx: Context }): Promise<Sent> {
  if (item.owner && item.value !== null && (!ctx.own || item.owner !== ctx.email)) return 'later'
  const value = item.value === null || !item.wire ? item.value : await item.wire()
  if (value === undefined) return 'later'
  const own = item.owner && ctx.own && item.value !== null ? { key: ctx.own, email: item.owner } : undefined
  const sealed = await sealRecord({ workspace: ctx.workspace, key: ctx.key, version: ctx.version, signer: ctx.me, id: item.id, ver, kind: item.kind, ref: item.ref, value, own })
  if (!sealed) return 'refused'
  const reply = await room(s, { method: 'PUT', path: `/records/${item.id}`, body: sealed })
  if (reply.status === 409) {
    await catchUp(s)
    return 'sent'
  }
  if (reply.status >= 400 && reply.status < 500 && !KEPT.includes(reply.status)) return 'refused'
  if (reply.status !== 200) throw new HttpError(502, `OpenHut Cloud refused a backup (HTTP ${reply.status}).`)
  await saveRow(s, { id: item.id, kind: item.kind, ref: item.ref, ver, hash: hashItem(item) })
  return 'sent'
}

async function localsOf({ s, kind, ctx }: { s: State; kind: Synced; ctx: Context }): Promise<Item[] | null> {
  const role = keysService.roleIn(s.ws)
  const items = await syncKinds.locals({ kind, admin: Boolean(role && role !== 'member'), ctx })
  return items && Promise.all(items.map(async (item) => ({ ...item, id: await slot({ key: ctx.slotKey, path: `${item.kind}/${item.ref}` }) })))
}

async function contextOf(s: State): Promise<Context | null> {
  const account = keysService.account()
  const found = keysService.room(s.ws)
  if (!account || !found?.workspace.key) return null
  const members = keysService.members(s.ws)?.members ?? []
  const signer = await keysService.accountDeviceKey()
  const runtimes = s.home ? members.filter((member) => member.role !== 'member').flatMap((member) => member.devices).filter((device) => device !== signer) : []
  const { id: workspace, key, version, old, slot: slotKey } = found.workspace
  const keys = Object.fromEntries([...Object.entries(old ?? {}), [String(version), key]].map(([each, value]) => [Number(each), fromBase64(value)]))
  return {
    workspace, home: s.home, key: fromBase64(key), version, keys, slotKey: fromBase64(slotKey ?? key), me: await keysService.device(), members, runtimes, own: await keysService.own(s.ws), email: account.email,
    putFile: async ({ hash, body }) => cloud.putFile({ workspace, hash, body, token: await keysService.token() }),
    getFile: async (hash) => cloud.getFile({ workspace, hash, token: await keysService.token() }),
    again: () => send(s, ['file']),
  }
}

async function rekey(s: State): Promise<boolean> {
  const behind = async () => {
    const account = keysService.account()
    const found = keysService.room(s.ws)
    const body = keysService.members(s.ws)
    const kit = s.home ? body?.members.find((member) => member.email === account?.email)?.kit : undefined
    return Boolean(account && found && body && (keyVersionOf(body) > found.workspace.version || (kit && account.key && kit !== await keysService.accountDeviceKey())))
  }
  if (!await behind()) return false
  const found = Letters.safeParse((await room(s, { method: 'GET', path: '/letters' })).json).data?.data ?? []
  for (const id of await keysService.takeLetters(found, s.ws)) await room(s, { method: 'DELETE', path: `/letters/${id}` })
  return behind()
}

async function checkRemoved(s: State): Promise<void> {
  if (!keysService.account()) return
  if ((await room(s, { method: 'GET', path: '/member-lists?after=0' })).status !== 403) return
  syncService.disconnect()
  await keysService.removedHere()
}

async function refreshMembers(s: State): Promise<boolean> {
  const before = keysService.members(s.ws)
  const reply = await room(s, { method: 'GET', path: `/member-lists?after=${before?.version ?? 0}` })
  const after = await keysService.advance(Lists.safeParse(reply.json).data?.data ?? [], s.ws)
  if (before && after) await welcome({ s, before, after })
  return Boolean(after)
}

async function welcome({ s, before, after }: { s: State; before: { members: { email: string }[] }; after: { members: { email: string; role: string; devices: string[] }[] } }): Promise<void> {
  const email = keysService.account()?.email
  const mine = after.members.find((member) => member.email === email)
  if (!mine || mine.role === 'member' || !keysService.account()?.key) return
  const fresh = after.members.filter((member) => member.email !== email && !before.members.some((each) => each.email === member.email)).flatMap((member) => member.devices)
  for (const letter of await keysService.welcomeLetters({ ws: s.ws, devices: fresh })) await room(s, { method: 'POST', path: '/letters', body: letter })
}

async function room(s: State, { method, path, body }: { method: 'GET' | 'PUT' | 'POST' | 'DELETE'; path: string; body?: unknown }): Promise<{ status: number; json: unknown }> {
  if (!keysService.account()) throw new HttpError(409, 'Turn on OpenHut Cloud first.')
  return cloud.room({ method, workspace: s.ws, path, token: await keysService.token(), body })
}

async function rowsById(s: State): Promise<Map<string, Row>> {
  const rows = await db.selectFrom('cloud_record').select(['id', 'kind', 'ref', 'ver', 'hash']).where('workspace', '=', rowKey(s)).execute()
  return new Map(rows.map((row) => [row.id, { ...row, kind: row.kind as Synced }]))
}

async function saveRow(s: State, row: Row): Promise<void> {
  const values = { ...row, workspace: rowKey(s) }
  await db.insertInto('cloud_record').values(values).onConflict((oc) => oc.column('id').doUpdateSet(values)).execute()
}

function rowKey(s: State): string {
  return s.home ? '' : s.ws
}

function seqName(s: State): string {
  return s.home ? SEQ : `${SEQ}:${s.ws}`
}

async function seqOf(s: State): Promise<number> {
  return Number((await db.selectFrom('install_setting').select('value').where('name', '=', seqName(s)).executeTakeFirst())?.value ?? 0)
}

function hashItem(item: { value: unknown; owner?: string }): string {
  return item.owner && item.value !== null ? hashOf([item.owner, item.value]) : hashOf(item.value)
}

function hashOf(value: unknown): string {
  return value === null ? DELETED : createHash('sha256').update(JSON.stringify(value)).digest('base64url')
}
