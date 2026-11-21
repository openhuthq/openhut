import { createHash } from 'node:crypto'
import ReconnectingWebSocket from 'partysocket/ws'
import * as z from 'zod/mini'
import { Letter, MemberList, parseJson, Record, type Backup } from '@openhut/common/cloud/cloud.ts'
import { keyVersionOf } from '@openhut/common/cloud/member-list.ts'
import { openRecord, sealRecord, SYNCED, type Opened, type Synced } from '@openhut/common/cloud/record.ts'
import { fromBase64, slot } from '@openhut/common/vault/vault.ts'
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
  [/^agent\./, ['agent']],
  [/^(setting|provider|admin)\./, ['setting']],
  [/^thread\.streamed$/, ['message']],
  [/^thread\./, ['message', 'file', 'memory']],
  [/^memory\.updated$/, ['memory']],
  [/^connection\./, ['connection']],
]
const Page = z.object({ data: z.array(Record), hasMore: z.boolean() })
const Lists = z.object({ data: z.array(MemberList) })
const Letters = z.object({ data: z.array(Letter) })
const Message = z.discriminatedUnion('type', [z.object({ type: z.literal('ready') }), z.object({ type: z.literal('members') }), z.object({ type: z.literal('record'), record: Record })])

type Item = Local & { id: string }
type Row = Omit<Local, 'value' | 'wire'> & { id: string; ver: number; hash: string }
type Sent = 'sent' | 'later' | 'refused'

let socket: ReconnectingWebSocket | undefined
let ready = false
let queue: Promise<void> = Promise.resolve()
let timer: NodeJS.Timeout | undefined
let headTimer: NodeJS.Timeout | undefined
let failures = 0
let wanted: [string, number][] | null = null
const refused = new Map<string, { kind: Synced; hash: string; name: string }>()
const dirty = new Set<Synced>()
const backup: Backup = { state: 'idle', done: 0, total: 0, current: null, at: null, agent: null, problem: null }

listen((event) => {
  const kinds = KINDS_OF.find(([pattern]) => pattern.test(event.name))?.[1]
  if (kinds) syncService.send(kinds)
})

export const syncService = {
  connect(): void {
    const account = keysService.account()
    if (socket || !account || !keysService.session()) return
    socket = new ReconnectingWebSocket(cloud.roomUrl(account.workspace.id), [], { WebSocket: globalThis.WebSocket })
    socket.addEventListener('open', () => {
      keysService.token().then((token) => socket?.send(JSON.stringify({ type: 'hello', token })), (err: unknown) => log.warn({ event: 'cloud.refresh_failed', error: messageOf(err) }))
    })
    socket.addEventListener('message', (event) => heard(String(event.data)))
    socket.addEventListener('close', (event) => {
      ready = false
      if (event.code === 4001 || event.code === 4003) void run(checkRemoved)
    })
  },

  disconnect(): void {
    socket?.close()
    socket = undefined
    ready = false
    clearTimeout(timer)
    clearTimeout(headTimer)
    timer = undefined
    dirty.clear()
  },

  async reset({ restoring }: { restoring: boolean }): Promise<void> {
    syncService.disconnect()
    await run(async () => {
      await db.deleteFrom('cloud_record').execute()
      await db.deleteFrom('install_setting').where('name', '=', SEQ).execute()
    })
    Object.assign(backup, { state: restoring ? 'restoring' : 'idle', done: 0, total: 0, current: null, at: null, agent: null, problem: null })
    wanted = null
    refused.clear()
  },

  ready: (): boolean => ready,

  send(kinds: readonly Synced[] = SYNCED): void {
    if (!socket) return
    for (const kind of kinds) dirty.add(kind)
    timer ??= setTimeout(() => {
      timer = undefined
      void run(flush)
    }, THROTTLE_MS)
  },

  retry(ms: number): void {
    if (!socket) return
    clearTimeout(timer)
    timer = setTimeout(() => {
      timer = undefined
      void run(flush)
    }, ms)
  },

  status: (): Backup => {
    const stuck = refused.values().next().value
    return { ...backup, problem: backup.problem ?? (stuck ? `${stuck.name} can’t be backed up: it doesn’t fit what OpenHut Cloud keeps.` : null) }
  },

  settled: (): Promise<void> => queue,
}

function heard(text: string): void {
  const message = Message.safeParse(parseJson(text)).data
  if (message?.type === 'ready') {
    ready = true
    void run(catchUp)
    syncService.send()
  }
  if (message?.type === 'members') void run(async () => {
    if (!await refreshMembers()) return
    await rekey()
    syncService.send(['connection'])
  })
  if (message?.type === 'record') void run(async () => message.record.seq === await seqOf() + 1 ? applyAll([message.record]) : catchUp())
}

function run(step: () => Promise<void>): Promise<void> {
  queue = queue.then(step).catch((err: unknown) => log.warn({ event: 'cloud.sync_failed', error: messageOf(err) }))
  return queue
}

async function catchUp(): Promise<void> {
  try {
    const records: Record[] = []
    for (let after = await seqOf(), more = true; more;) {
      const page = Page.safeParse((await room({ method: 'GET', path: `/records?after=${after}` })).json)
      if (!page.success) throw new HttpError(502, 'OpenHut Cloud sent records this computer can’t read.')
      records.push(...page.data.data)
      more = page.data.hasMore && page.data.data.length > 0
      after = page.data.data.at(-1)?.seq ?? after
    }
    await applyAll(records)
  } finally {
    if (backup.state === 'restoring') Object.assign(backup, { state: 'idle', at: new Date().toISOString() })
  }
}

async function applyAll(records: Record[]): Promise<void> {
  const ctx = await contextOf()
  const rows = await rowsById()
  const opened: [Record, Opened][] = []
  for (const record of records.filter((each) => (rows.get(each.id)?.ver ?? 0) < each.ver)) {
    const open = ctx && await openSafely({ record, ctx })
    if (open) opened.push([record, open])
    else log.warn({ event: 'cloud.record_dropped', record: record.id, seq: record.seq })
  }
  const after = await contextOf() ?? ctx
  opened.sort(([, a], [, b]) => FIRST.indexOf(b.kind) - FIRST.indexOf(a.kind))
  const restoring = backup.state === 'restoring'
  if (restoring) Object.assign(backup, { done: 0, total: opened.filter(([, open]) => open.kind === 'agent' && open.value).length })
  const expected = new Map<string, unknown>()
  for (const [record, open] of opened) {
    if (open.kind === 'agent' && open.value) backup.current = open.value.name
    expected.set(record.id, after && await syncKinds.apply({ open, ctx: after }).catch((err: unknown) => log.warn({ event: 'cloud.apply_failed', record: record.id, error: messageOf(err) })))
    if (restoring && open.kind === 'agent' && open.value) Object.assign(backup, { done: backup.done + 1, agent: open.ref })
  }
  const locals = new Map<Synced, Map<string, unknown>>()
  for (const kind of new Set(opened.map(([, open]) => open.kind))) {
    const mine = after && kind !== 'file' ? await localsOf({ kind, ctx: after }).catch(() => null) : null
    locals.set(kind, new Map((mine ?? []).map((each) => [each.id, each.value])))
  }
  for (const [record, open] of opened) {
    const local = open.kind === 'file' ? expected.get(record.id) : locals.get(open.kind)?.get(record.id)
    await saveRow({ id: record.id, kind: open.kind, ref: open.ref, ver: record.ver, hash: hashOf(local ?? null) })
  }
  const head = opened.map(([, open]) => open).find((open) => open.kind === 'head')
  if ((restoring || wanted) && head?.kind === 'head' && head.value) wanted = head.value.records
  if (wanted) await checkHead(wanted)
  const last = records.at(-1)
  if (last && last.seq > await seqOf()) await db.insertInto('install_setting').values({ name: SEQ, value: String(last.seq) }).onConflict((oc) => oc.column('name').doUpdateSet({ value: String(last.seq) })).execute()
}

async function openSafely({ record, ctx }: { record: Record; ctx: Context }): Promise<Opened | null> {
  const open = () => openRecord({ workspace: ctx.workspace, keys: ctx.keys, record, members: keysService.members()?.members ?? [] })
  const opened = await open() ?? (await refreshMembers() ? await open() : null)
  return opened && record.id === await slot({ key: ctx.slotKey, path: `${opened.kind}/${opened.ref}` }) ? opened : null
}

async function checkHead(records: [string, number][]): Promise<void> {
  const rows = await rowsById()
  const missing = records.filter(([id, ver]) => (rows.get(id)?.ver ?? 0) < ver).length
  backup.problem = missing ? `${missing} of ${records.length} agents and settings didn’t come back. Open OpenHut on your other ${HERE} so it backs them up again.` : null
  if (!missing) wanted = null
}

async function flush(): Promise<void> {
  if (ready && await rekey()) return syncService.retry(RETRY_MS * 2)
  const ctx = await contextOf()
  if (!ready || !ctx) return
  const kinds = SYNCED.filter((kind) => dirty.delete(kind))
  const changed = await unsent({ kinds, ctx })
  if (!changed.length) {
    if (backup.state === 'failed' && !refused.size) Object.assign(backup, { state: 'idle', at: new Date().toISOString() })
    return
  }
  const stuck = [...refused.keys()].filter((id) => !changed.some((each) => each.id === id)).length
  Object.assign(backup, { state: 'backing_up', done: 0, total: changed.length + stuck, current: null })
  const later = new Set<string>()
  try {
    for (const item of changed) {
      const sent = await put({ item, ver: ((await rowsById()).get(item.id)?.ver ?? 0) + 1, ctx })
      if (sent === 'later') later.add(item.id)
      if (sent === 'refused') refused.set(item.id, { kind: item.kind, hash: hashOf(item.value), name: nameOf(item) })
      else backup.done++
      if (sent === 'sent') refused.delete(item.id)
    }
  } catch (err) {
    log.warn({ event: 'cloud.backup_failed', error: messageOf(err) })
  }
  const tried = new Set(changed.map((each) => each.id).filter((id) => !later.has(id)))
  if ((await unsent({ kinds, ctx })).some((each) => tried.has(each.id))) {
    for (const kind of kinds) dirty.add(kind)
    backup.state = 'failed'
    failures++
    return syncService.retry(Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (failures - 1)))
  }
  failures = 0
  clearTimeout(headTimer)
  if (changed.some((each) => each.kind !== 'message')) await writeHead()
  else headTimer = setTimeout(() => void run(writeHead), HEAD_MS)
  Object.assign(backup, refused.size ? { state: 'failed' } : { state: 'idle', at: new Date().toISOString() })
}

function nameOf(item: Item): string {
  const name = item.kind === 'agent' && item.value && typeof item.value === 'object' && 'name' in item.value ? String(item.value.name) : ''
  return name || `A ${item.kind}`
}

async function unsent({ kinds, ctx }: { kinds: Synced[]; ctx: Context }): Promise<Item[]> {
  const rows = await rowsById()
  const changed: Item[] = []
  for (const kind of kinds) {
    const mine = await localsOf({ kind, ctx }).catch((err: unknown) => { log.warn({ event: 'cloud.locals_failed', kind, error: messageOf(err) }) })
    if (!mine) continue
    const ids = new Set(mine.map((each) => each.id))
    for (const [id, each] of refused) if (each.kind === kind && !ids.has(id)) refused.delete(id)
    const gone = TOMBSTONED.includes(kind) ? [...rows.values()].filter((row) => row.kind === kind && row.hash !== DELETED && !ids.has(row.id)).map((row) => ({ ...row, value: null })) : []
    changed.push(...[...mine, ...gone].filter((each) => ![rows.get(each.id)?.hash, refused.get(each.id)?.hash].includes(hashOf(each.value))))
  }
  return changed
}

async function writeHead(): Promise<void> {
  const ctx = await contextOf()
  if (!ready || !ctx) return
  const rows = await rowsById()
  const id = await slot({ key: ctx.slotKey, path: `${HEAD}/${HEAD}` })
  const records = [...rows.values()].filter((row) => row.kind !== HEAD && row.hash !== DELETED).map((row): [string, number] => [row.id, row.ver])
  await put({ item: { id, kind: HEAD, ref: HEAD, value: { records } }, ver: (rows.get(id)?.ver ?? 0) + 1, ctx }).catch((err: unknown) => log.warn({ event: 'cloud.head_failed', error: messageOf(err) }))
}

async function put({ item, ver, ctx }: { item: Item; ver: number; ctx: Context }): Promise<Sent> {
  const value = item.value === null || !item.wire ? item.value : await item.wire()
  if (value === undefined) return 'later'
  const sealed = await sealRecord({ workspace: ctx.workspace, key: ctx.key, version: ctx.version, signer: ctx.me, id: item.id, ver, kind: item.kind, ref: item.ref, value })
  if (!sealed) return 'refused'
  const reply = await room({ method: 'PUT', path: `/records/${item.id}`, body: sealed })
  if (reply.status === 409) {
    await catchUp()
    return 'sent'
  }
  if (reply.status >= 400 && reply.status < 500 && !KEPT.includes(reply.status)) return 'refused'
  if (reply.status !== 200) throw new HttpError(502, `OpenHut Cloud refused a backup (HTTP ${reply.status}).`)
  await saveRow({ id: item.id, kind: item.kind, ref: item.ref, ver, hash: hashOf(item.value) })
  return 'sent'
}

async function localsOf({ kind, ctx }: { kind: Synced; ctx: Context }): Promise<Item[] | null> {
  const account = keysService.account()
  const admin = Boolean(account && ctx.members.some((member) => member.email === account.email && member.role !== 'member'))
  const items = await syncKinds.locals({ kind, admin, ctx })
  return items && Promise.all(items.map(async (item) => ({ ...item, id: await slot({ key: ctx.slotKey, path: `${item.kind}/${item.ref}` }) })))
}

async function contextOf(): Promise<Context | null> {
  const account = keysService.account()
  if (!account) return null
  const members = keysService.members()?.members ?? []
  const signer = await keysService.accountDeviceKey()
  const runtimes = members.filter((member) => member.role !== 'member').flatMap((member) => member.devices).filter((device) => device !== signer)
  const { id: workspace, key, version, old, slot: slotKey } = account.workspace
  const keys = Object.fromEntries([...Object.entries(old ?? {}), [String(version), key]].map(([each, value]) => [Number(each), fromBase64(value)]))
  return {
    workspace, key: fromBase64(key), version, keys, slotKey: fromBase64(slotKey ?? key), me: await keysService.device(), members, runtimes,
    putFile: async ({ hash, body }) => cloud.putFile({ workspace, hash, body, token: await keysService.token() }),
    getFile: async (hash) => cloud.getFile({ workspace, hash, token: await keysService.token() }),
    again: () => syncService.send(['file']),
  }
}

async function rekey(): Promise<boolean> {
  const behind = async () => {
    const account = keysService.account()
    const body = keysService.members()
    const kit = body?.members.find((member) => member.email === account?.email)?.kit
    return Boolean(account && body && (keyVersionOf(body) > account.workspace.version || (kit && account.key && kit !== await keysService.accountDeviceKey())))
  }
  if (!await behind()) return false
  const found = Letters.safeParse((await room({ method: 'GET', path: '/letters' })).json).data?.data ?? []
  for (const id of await keysService.takeLetters(found)) await room({ method: 'DELETE', path: `/letters/${id}` })
  return behind()
}

async function checkRemoved(): Promise<void> {
  if (!keysService.account()) return
  if ((await room({ method: 'GET', path: '/member-lists?after=0' })).status !== 403) return
  syncService.disconnect()
  await keysService.removedHere()
}

async function refreshMembers(): Promise<boolean> {
  const reply = await room({ method: 'GET', path: `/member-lists?after=${keysService.members()?.version ?? 0}` })
  return Boolean(await keysService.advance(Lists.safeParse(reply.json).data?.data ?? []))
}

async function room({ method, path, body }: { method: 'GET' | 'PUT' | 'DELETE'; path: string; body?: unknown }): Promise<{ status: number; json: unknown }> {
  const account = keysService.account()
  if (!account) throw new HttpError(409, 'Turn on OpenHut Cloud first.')
  return cloud.room({ method, workspace: account.workspace.id, path, token: await keysService.token(), body })
}

async function rowsById(): Promise<Map<string, Row>> {
  const rows = await db.selectFrom('cloud_record').selectAll().execute()
  return new Map(rows.map((row) => [row.id, { ...row, kind: row.kind as Synced }]))
}

async function saveRow(row: Row): Promise<void> {
  await db.insertInto('cloud_record').values(row).onConflict((oc) => oc.column('id').doUpdateSet(row)).execute()
}

async function seqOf(): Promise<number> {
  return Number((await db.selectFrom('install_setting').select('value').where('name', '=', SEQ).executeTakeFirst())?.value ?? 0)
}

function hashOf(value: unknown): string {
  return value === null ? DELETED : createHash('sha256').update(JSON.stringify(value)).digest('base64url')
}
