import { createHash } from 'node:crypto'
import ReconnectingWebSocket from 'partysocket/ws'
import * as z from 'zod/mini'
import { MemberList, parseJson, Record, type Backup } from '@openhut/common/cloud/cloud.ts'
import { openRecord, sealRecord, type Opened, type Synced } from '@openhut/common/cloud/record.ts'
import { PROVIDERS } from '@openhut/common/models/provider.ts'
import { fromBase64, slot } from '@openhut/common/vault/vault.ts'
import { agentService } from '../agents/agent-service.ts'
import { cloud } from '../platform/cloud.ts'
import { db } from '../platform/db.ts'
import { listen, log, setUsageData } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { settings } from '../platform/settings.ts'
import { routineService } from '../routines/routine-service.ts'
import { keysService } from './keys-service.ts'

const DEBOUNCE_MS = 300
const RETRY_MS = 1000
const RETRY_MAX_MS = 60_000
const HEAD = 'head'
const DELETED = 'deleted'
const SEQ = 'cloud_seq'
const SYNCED_EVENT = /^(agent|setting|provider|admin)\./
const Page = z.object({ data: z.array(Record), hasMore: z.boolean() })
const Lists = z.object({ data: z.array(MemberList) })
const Message = z.discriminatedUnion('type', [z.object({ type: z.literal('ready') }), z.object({ type: z.literal('members') }), z.object({ type: z.literal('record'), record: Record })])

type Local = { id: string; kind: Synced; ref: string; value: unknown }
type Row = Omit<Local, 'value'> & { ver: number; hash: string }

let socket: ReconnectingWebSocket | undefined
let ready = false
let queue: Promise<void> = Promise.resolve()
let timer: NodeJS.Timeout | undefined
let failures = 0
const backup: Backup = { state: 'idle', done: 0, total: 0, current: null, at: null, agent: null, problem: null }

listen((event) => { if (SYNCED_EVENT.test(event.name)) syncService.send() })

export const syncService = {
  connect(): void {
    const account = keysService.account()
    if (socket || !account || !keysService.session()) return
    socket = new ReconnectingWebSocket(cloud.roomUrl(account.workspace.id), [], { WebSocket: globalThis.WebSocket })
    socket.addEventListener('open', () => {
      keysService.token().then((token) => socket?.send(JSON.stringify({ type: 'hello', token })), (err: unknown) => log.warn({ event: 'cloud.refresh_failed', error: messageOf(err) }))
    })
    socket.addEventListener('message', (event) => heard(String(event.data)))
    socket.addEventListener('close', () => { ready = false })
  },

  disconnect(): void {
    socket?.close()
    socket = undefined
    ready = false
  },

  async reset({ restoring }: { restoring: boolean }): Promise<void> {
    syncService.disconnect()
    await db.deleteFrom('cloud_record').execute()
    await db.deleteFrom('install_setting').where('name', '=', SEQ).execute()
    Object.assign(backup, { state: restoring ? 'restoring' : 'idle', done: 0, total: 0, current: null, at: null, agent: null, problem: null })
  },

  ready: (): boolean => ready,

  send(): void {
    later(DEBOUNCE_MS)
  },

  status: (): Backup => ({ ...backup }),

  settled: (): Promise<void> => queue,
}

function heard(text: string): void {
  const message = Message.safeParse(parseJson(text)).data
  if (message?.type === 'ready') {
    ready = true
    void run(catchUp)
    void run(flush)
  }
  if (message?.type === 'members') void run(async () => { await refreshMembers() })
  if (message?.type === 'record') void run(async () => message.record.seq === await seqOf() + 1 ? applyAll([message.record]) : catchUp())
}

function later(ms: number): void {
  if (!socket) return
  clearTimeout(timer)
  timer = setTimeout(() => void run(flush), ms)
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
  const rows = await rowsById()
  const opened: [Record, Opened][] = []
  for (const record of records.filter((each) => (rows.get(each.id)?.ver ?? 0) < each.ver)) {
    const open = await openSafely(record)
    if (open) opened.push([record, open])
    else log.warn({ event: 'cloud.record_dropped', record: record.id, seq: record.seq })
  }
  const restoring = backup.state === 'restoring'
  if (restoring) Object.assign(backup, { done: 0, total: opened.filter(([, open]) => open.kind === 'agent' && open.value).length })
  for (const [record, open] of opened) {
    if (open.kind === 'agent' && open.value) backup.current = open.value.name
    await applyLocal(open).catch((err: unknown) => log.warn({ event: 'cloud.apply_failed', record: record.id, error: messageOf(err) }))
    const now = (await locals()).find((each) => each.id === record.id)
    await saveRow({ id: record.id, kind: open.kind, ref: open.ref, ver: record.ver, hash: hashOf(now?.value ?? null) })
    if (restoring && open.kind === 'agent' && open.value) Object.assign(backup, { done: backup.done + 1, agent: open.ref })
  }
  const head = opened.map(([, open]) => open).find((open) => open.kind === 'head')
  if (restoring && head?.kind === 'head' && head.value) await checkHead(head.value.records)
  const last = records.at(-1)
  if (last && last.seq > await seqOf()) await db.insertInto('install_setting').values({ name: SEQ, value: String(last.seq) }).onConflict((oc) => oc.column('name').doUpdateSet({ value: String(last.seq) })).execute()
}

async function openSafely(record: Record): Promise<Opened | null> {
  const account = keysService.account()
  if (!account) return null
  const open = () => openRecord({ workspace: account.workspace.id, keys: { [account.workspace.version]: fromBase64(account.workspace.key) }, record, members: keysService.members()?.members ?? [] })
  const opened = await open() ?? (await refreshMembers() ? await open() : null)
  return opened && record.id === await slotOf(`${opened.kind}/${opened.ref}`) ? opened : null
}

async function checkHead(records: [string, number][]): Promise<void> {
  const rows = await rowsById()
  const missing = records.filter(([id, ver]) => (rows.get(id)?.ver ?? 0) < ver).length
  backup.problem = missing ? `OpenHut Cloud sent an incomplete or older backup: ${missing} of ${records.length} agents and settings are missing or out of date.` : null
}

async function applyLocal(open: Opened): Promise<void> {
  if (open.kind === 'agent') return agentService.applySynced({ id: open.ref, value: open.value })
  if (open.kind !== 'setting' || !open.value) return
  const setting = open.value
  if (setting.name === 'time_zone') return routineService.setTimeZone(setting.value)
  if (setting.name === 'usage_data') {
    await settings.setUsageData(setting.value)
    return setUsageData(setting.value)
  }
  for (const { provider, at, models } of setting.value) await settings.setCatalog(provider, { at, models })
}

async function unsent(): Promise<Local[]> {
  const rows = await rowsById()
  const mine = await locals()
  const ids = new Set(mine.map((each) => each.id))
  const gone = [...rows.values()].filter((row) => row.kind === 'agent' && row.hash !== DELETED && !ids.has(row.id)).map((row) => ({ ...row, value: null }))
  return [...mine, ...gone].filter((each) => rows.get(each.id)?.hash !== hashOf(each.value))
}

async function flush(): Promise<void> {
  if (!ready) return
  const changed = await unsent()
  if (!changed.length) {
    if (backup.state === 'failed') Object.assign(backup, { state: 'idle', at: new Date().toISOString() })
    return
  }
  Object.assign(backup, { state: 'backing_up', done: 0, total: changed.length, current: null })
  try {
    for (const item of changed) {
      await put({ item, ver: ((await rowsById()).get(item.id)?.ver ?? 0) + 1 })
      backup.done++
    }
  } catch (err) {
    log.warn({ event: 'cloud.backup_failed', error: messageOf(err) })
  }
  const tried = new Set(changed.map((each) => each.id))
  if ((await unsent()).some((each) => tried.has(each.id))) {
    backup.state = 'failed'
    failures++
    return later(Math.min(RETRY_MAX_MS, RETRY_MS * 2 ** (failures - 1)))
  }
  failures = 0
  await writeHead().catch((err: unknown) => log.warn({ event: 'cloud.head_failed', error: messageOf(err) }))
  Object.assign(backup, { state: 'idle', at: new Date().toISOString() })
}

async function writeHead(): Promise<void> {
  const rows = await rowsById()
  const id = await slotOf(`${HEAD}/${HEAD}`)
  const records = [...rows.values()].filter((row) => row.kind !== HEAD).map((row): [string, number] => [row.id, row.ver])
  await put({ item: { id, kind: HEAD, ref: HEAD, value: { records } }, ver: (rows.get(id)?.ver ?? 0) + 1 })
}

async function put({ item, ver }: { item: Local; ver: number }): Promise<void> {
  const account = keysService.account()
  if (!account) return
  const sealed = await sealRecord({
    workspace: account.workspace.id, key: fromBase64(account.workspace.key), version: account.workspace.version, signer: await keysService.device(), id: item.id, ver, kind: item.kind, ref: item.ref, value: item.value,
  })
  if (!sealed) throw new HttpError(400, `This ${item.kind} can’t be backed up: it doesn’t fit what OpenHut Cloud keeps.`)
  const reply = await room({ method: 'PUT', path: `/records/${item.id}`, body: sealed })
  if (reply.status === 409) return catchUp()
  if (reply.status !== 200) throw new HttpError(502, `OpenHut Cloud refused a backup (HTTP ${reply.status}).`)
  await saveRow({ id: item.id, kind: item.kind, ref: item.ref, ver, hash: hashOf(item.value) })
}

async function locals(): Promise<Local[]> {
  const account = keysService.account()
  if (!account) return []
  const admin = keysService.members()?.members.some((member) => member.email === account.email && member.role !== 'member')
  const items: Omit<Local, 'id'>[] = (await agentService.synced()).map((value) => ({ kind: 'agent', ref: value.id, value }))
  if (admin) items.push(
    { kind: 'setting', ref: 'time_zone', value: { name: 'time_zone', value: settings.timeZone() } },
    { kind: 'setting', ref: 'usage_data', value: { name: 'usage_data', value: settings.usageData() } },
    { kind: 'setting', ref: 'models', value: { name: 'models', value: PROVIDERS.flatMap(({ id }) => { const catalog = settings.catalog(id); return catalog ? [{ provider: id, ...catalog }] : [] }) } },
  )
  return Promise.all(items.map(async (item) => ({ ...item, id: await slotOf(`${item.kind}/${item.ref}`) })))
}

async function slotOf(path: string): Promise<string> {
  return slot({ key: fromBase64(keysService.account()?.workspace.key ?? ''), path })
}

async function refreshMembers(): Promise<boolean> {
  const reply = await room({ method: 'GET', path: `/member-lists?after=${keysService.members()?.version ?? 0}` })
  return Boolean(await keysService.advance(Lists.safeParse(reply.json).data?.data ?? []))
}

async function room({ method, path, body }: { method: 'GET' | 'PUT'; path: string; body?: unknown }): Promise<{ status: number; json: unknown }> {
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
