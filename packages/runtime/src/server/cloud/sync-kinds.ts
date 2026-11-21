import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { parseJson, type Member } from '@openhut/common/cloud/cloud.ts'
import type { AgentValue, FileValue, Opened, Synced } from '@openhut/common/cloud/record.ts'
import { PROVIDERS } from '@openhut/common/models/provider.ts'
import { fileInHome, uploadName, type ChatMessage } from '@openhut/common/threads/thread.ts'
import { fromBase64, letter, lock, read, toBase64, unlock, type Bytes, type Identity } from '@openhut/common/vault/vault.ts'
import { agentService } from '../agents/agent-service.ts'
import { memoryService } from '../agents/memory-service.ts'
import { connectionService } from '../connections/connection-service.ts'
import { agentd } from '../platform/agentd.ts'
import { log, setUsageData } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { settings } from '../platform/settings.ts'
import { routineService } from '../routines/routine-service.ts'
import { threadService } from '../threads/thread-service.ts'

export type Local = { kind: Synced; ref: string; value: unknown; wire?: () => Promise<unknown>; owner?: string; agentId?: string; assistant?: boolean }
export type Context = {
  workspace: string; home: boolean; key: Bytes; version: number; keys: Record<number, Bytes>; slotKey: Bytes; me: Identity; members: Member[]; runtimes: string[]; own: Bytes | null; email: string; admin: boolean
  putFile: (input: { hash: string; body: Bytes }) => Promise<number>; getFile: (hash: string) => Promise<Bytes | null>; again: () => void
  landed: (input: { kind: Synced; ref: string; value: unknown; owner: string | undefined }) => void
}
export type Row = { signer: string | null; agent_id: string | null }

const MAX_FILE = 32 << 20
const STAT_BATCH = 50
const AGAIN_MS = 30_000
const RETRY_MS = 2000
const RETRY_MAX_MS = 5 * 60_000
const Config = z.record(z.string(), z.unknown())
const CODE_PATH = /`([^`\n]{1,1024})`/g
const text = new TextEncoder()
const words = new TextDecoder()
const shas = new Map<string, string>()
const uploaded = new Map<string, string>()
type Owned = Map<string, string | undefined>
const uploading = new Set<string>()
const downloading = new Map<string, FileValue>()

export const syncKinds = {
  async locals({ kind, ctx }: { kind: Synced; ctx: Context }): Promise<Local[] | null> {
    const me = toBase64(ctx.me.publicKey)
    const agents = await agentService.synced({ workspace: ctx.home ? null : ctx.workspace, owner: ctx.email })
    const owned: Owned = new Map(agents.map((agent) => [agent.id, agent.shared ? undefined : agent.owner]))
    switch (kind) {
      case 'agent': return agents.map((value) => ({ kind, ref: value.id, value, owner: owned.get(value.id) }))
      case 'setting': return ctx.admin && ctx.home ? settingLocals() : null
      case 'connection': return ctx.admin && ctx.home ? connectionLocals(ctx) : null
      case 'message': return (await threadService.synced()).filter((value) => owned.has(value.agentId)).map((value) => ({ kind, ref: value.message.id, value, owner: owned.get(value.agentId), agentId: value.agentId, assistant: value.message.role === 'assistant' }))
      case 'memory': {
        const here = agents.filter((agent) => agent.runsOn === me).map((agent) => agent.id)
        return (await memoryService.synced({ agentIds: here })).map((value) => ({ kind, ref: value.agentId, value, owner: owned.get(value.agentId), agentId: value.agentId }))
      }
      case 'file': return fileLocals({ ctx, owned })
      case 'head': return null
    }
  },

  async hide({ open, ctx }: { open: Opened; ctx: Context }): Promise<undefined> {
    if (open.kind === 'agent' && open.owner && open.owner !== ctx.email) await agentService.hideSynced({ id: open.ref, owner: open.owner, workspace: workspaceOf(ctx), me: ctx.email })
    return undefined
  },

  async allowed({ open, ctx, row }: { open: Opened; ctx: Context; row: Row | undefined }): Promise<boolean> {
    const runner = async (id: string) => (await agentService.placement({ id }))?.runsOn
    switch (open.kind) {
      case 'agent': return !open.value || agentAllowed({ value: open.value, by: open.by, ctx })
      case 'memory': return await runner(open.value?.agentId ?? open.ref) === open.by
      case 'message': {
        const runsOn = await runner(open.value?.agentId ?? row?.agent_id ?? '')
        if (open.value?.message.role === 'assistant') return runsOn === open.by
        return !row?.signer || row.signer === open.by || (!open.value && runsOn === open.by)
      }
      default: return true
    }
  },

  async apply({ open, ctx }: { open: Opened; ctx: Context }): Promise<unknown> {
    const author = ctx.members.find((member) => member.devices.includes(open.by))
    if (!author) return undefined
    const agentId = await agentOf(open)
    if (agentId && !await agentService.writableBy({ id: agentId, author, workspace: workspaceOf(ctx), me: ctx.email })) return undefined
    const mine = author.email === ctx.email
    const by = author.email
    switch (open.kind) {
      case 'agent': {
        const devices = [toBase64(ctx.me.publicKey), ...ctx.members.find((member) => member.email === ctx.email)?.devices ?? []]
        return agentService.applySynced({ id: open.ref, value: open.value, author: { ...author, device: open.by }, workspace: workspaceOf(ctx), me: ctx.email, mine: devices })
      }
      case 'setting': return open.value && ctx.home && mine ? applySetting(open.value) : undefined
      case 'message': return threadService.applySynced({ id: open.ref, value: open.value, author: by })
      case 'memory': return open.value && memoryService.applySynced(open.value)
      case 'file': return open.value ? applyFile({ value: open.value, ctx, owner: open.owner }) : undefined
      case 'head': return undefined
      case 'connection': {
        if (!ctx.home || !mine) return undefined
        const value = open.value
        if (!value) return connectionService.applySynced({ id: open.ref, value: null, by })
        const sealed = value.keys.find((each) => each.to === toBase64(ctx.me.publicKey))
        const plain = sealed && await read({ recipient: ctx.me, from: fromBase64(open.by), workspace: ctx.workspace, purpose: 'connection-key', body: fromBase64(sealed.body), allowed: ctx.runtimes.map(fromBase64) })
        const config = plain ? Config.safeParse(parseJson(words.decode(plain))).data ?? null : null
        return connectionService.applySynced({ id: value.id, value: { id: value.id, kind: value.kind, name: value.name, account: value.account, signIn: value.signIn, config }, by })
      }
    }
  },
}

function workspaceOf(ctx: Context): string | null {
  return ctx.home ? null : ctx.workspace
}

async function agentOf(open: Opened): Promise<string | undefined> {
  if (open.kind === 'message') return threadService.agentOfMessage({ id: open.ref, value: open.value })
  if (open.kind === 'memory' || open.kind === 'file') return open.value?.agentId
  return undefined
}

async function agentAllowed({ value, by, ctx }: { value: AgentValue; by: string; ctx: Context }): Promise<boolean> {
  const author = ctx.members.find((each) => each.devices.includes(by))
  const current = await agentService.placement({ id: value.id })
  const limited = author?.role === 'member' && (current?.owner ?? (current ? ctx.email : author.email)) !== author.email
  const listed = (device: string | undefined) => device !== undefined && ctx.members.some((each) => each.devices.includes(device))
  const claim = value.runsOn === by && !listed(current?.runsOn)
  if (value.runsOn !== current?.runsOn && (!listed(value.runsOn) || (limited && !claim))) return false
  return !limited || value.codeExecution === (current?.codeExecution ?? false)
}

function settingLocals(): Local[] {
  const kind = 'setting'
  return [
    { kind, ref: 'time_zone', value: { name: 'time_zone', value: settings.timeZone() } },
    { kind, ref: 'usage_data', value: { name: 'usage_data', value: settings.usageData() } },
    { kind, ref: 'models', value: { name: 'models', value: PROVIDERS.flatMap(({ id }) => { const catalog = settings.catalog(id); return catalog ? [{ provider: id, ...catalog }] : [] }) } },
  ]
}

async function applySetting(setting: Extract<Opened, { kind: 'setting' }>['value'] & object): Promise<void> {
  if (setting.name === 'time_zone') return routineService.setTimeZone(setting.value)
  if (setting.name === 'usage_data') {
    await settings.setUsageData(setting.value)
    return setUsageData(setting.value)
  }
  for (const { provider, at, models } of setting.value) await settings.setCatalog(provider, { at, models })
}

async function connectionLocals(ctx: Context): Promise<Local[]> {
  const to = [...ctx.runtimes].sort()
  return (await connectionService.synced()).flatMap(({ config, ...plain }) => config ? [{
    kind: 'connection' as const, ref: plain.id, value: { ...plain, config, to },
    wire: async () => ({ ...plain, keys: await Promise.all(to.map(async (device) => ({ to: device, body: toBase64(await letter({ sender: ctx.me, to: fromBase64(device), workspace: ctx.workspace, purpose: 'connection-key', version: ctx.version, plain: text.encode(JSON.stringify(config)) }) ?? new Uint8Array()) }))) }),
  }] : [])
}

async function fileLocals({ ctx, owned }: { ctx: Context; owned: Owned }): Promise<Local[]> {
  const wanted = new Map<string, string[]>()
  for (const { agentId, message } of await threadService.synced()) if (owned.has(agentId)) wanted.set(agentId, [...new Set([...wanted.get(agentId) ?? [], ...pathsIn(message)])])
  const locals: Local[] = []
  for (const [agentId, paths] of wanted) {
    for (let start = 0; start < paths.length; start += STAT_BATCH) {
      const { files } = await agentd.stat({ id: agentId, paths: paths.slice(start, start + STAT_BATCH).map((path) => `home/${path}`) }).catch(() => ({ files: [] }))
      for (const file of files.filter((each) => each.size <= MAX_FILE)) {
        const path = file.path.slice('home/'.length)
        const ref = `${agentId}/${path}`
        if (downloading.has(ref)) continue
        const sha = shas.get(`${ref}:${file.size}`) ?? await hashFile({ agentId, path, size: file.size })
        if (!sha) continue
        const value = { agentId, path, size: file.size, sha }
        const owner = owned.get(agentId)
        locals.push({ kind: 'file', ref, value, owner, agentId, wire: async () => wireFile({ value, ctx, owner }) })
      }
    }
  }
  return locals
}

function pathsIn(message: ChatMessage): string[] {
  return message.parts.flatMap((part) => {
    if (part.type === 'file' && typeof part.url === 'string') return [part.url]
    return part.type === 'text' && typeof part.text === 'string' ? [...part.text.matchAll(CODE_PATH)].map((match) => match[1] ?? '') : []
  }).flatMap((path) => uploadName(path) ? fileInHome(path) ?? [] : []).slice(0, 50)
}

async function hashFile({ agentId, path, size }: { agentId: string; path: string; size: number }): Promise<string | null> {
  const body = await agentd.read({ id: agentId, path: `home/${path}` }).catch(() => null)
  if (!body || body.length !== size) return null
  const sha = hashOf(body)
  shas.set(`${agentId}/${path}:${size}`, sha)
  return sha
}

async function wireFile({ value, ctx, owner }: { value: Omit<FileValue, 'blob'>; ctx: Context; owner: string | undefined }): Promise<FileValue | undefined> {
  const cached = `${value.sha}:${owner ?? ''}`
  const blob = uploaded.get(cached)
  if (blob) return { ...value, blob }
  if (uploading.has(cached)) return undefined
  uploading.add(cached)
  void upload({ value, ctx, owner }).then((hash) => {
    uploaded.set(cached, hash)
    ctx.again()
  }, (err: unknown) => {
    log.warn({ event: 'cloud.file_upload_failed', error: messageOf(err) })
    setTimeout(ctx.again, AGAIN_MS)
  }).finally(() => uploading.delete(cached))
  return undefined
}

function fileKey({ ctx, owner }: { ctx: Context; owner: string | undefined }): { keys: Record<number, Bytes>; key: Bytes; bind: string } | null {
  if (!owner) return { keys: ctx.keys, key: ctx.key, bind: fileBind(ctx.workspace) }
  const own = ctx.own
  if (!own || owner !== ctx.email) return null
  return { keys: Object.fromEntries([...Object.keys(ctx.keys), String(ctx.version)].map((version) => [Number(version), own])), key: own, bind: `${fileBind(ctx.workspace)}/own/${owner}` }
}

async function upload({ value, ctx, owner }: { value: Omit<FileValue, 'blob'>; ctx: Context; owner: string | undefined }): Promise<string> {
  const locking = fileKey({ ctx, owner })
  if (!locking) throw new HttpError(409, 'This computer can’t lock that private file.')
  const body = await agentd.read({ id: value.agentId, path: `home/${value.path}` })
  if (!body || hashOf(body) !== value.sha) throw new HttpError(409, 'The file changed while it was being backed up.')
  const locked = await lock({ key: locking.key, version: ctx.version, bind: locking.bind, plain: new Uint8Array(body) })
  if (!locked) throw new HttpError(500, 'This computer couldn’t lock a file.')
  const hash = hashOf(locked)
  const status = await ctx.putFile({ hash, body: locked })
  if (status !== 200) throw new HttpError(502, `OpenHut Cloud refused a file (HTTP ${status}).`)
  return hash
}

function applyFile({ value, ctx, owner }: { value: FileValue; ctx: Context; owner: string | undefined }): undefined {
  const { blob, ...local } = value
  const ref = `${value.agentId}/${value.path}`
  uploaded.set(`${value.sha}:${owner ?? ''}`, blob)
  if (shas.get(`${ref}:${value.size}`) === value.sha) ctx.landed({ kind: 'file', ref, value: local, owner })
  else fetchFile({ value, ctx, owner, wait: RETRY_MS })
  return undefined
}

function fetchFile({ value, ctx, owner, wait }: { value: FileValue; ctx: Context; owner: string | undefined; wait: number }): void {
  const { blob: _, ...local } = value
  const ref = `${value.agentId}/${value.path}`
  downloading.set(ref, value)
  download({ value, ctx, owner }).then(() => {
    if (downloading.get(ref) === value) downloading.delete(ref)
    ctx.landed({ kind: 'file', ref, value: local, owner })
  }, (err: unknown) => {
    log.warn({ event: 'cloud.file_download_failed', error: messageOf(err), retryInMs: wait })
    if (downloading.get(ref) === value) setTimeout(() => { if (downloading.get(ref) === value) fetchFile({ value, ctx, owner, wait: Math.min(RETRY_MAX_MS, wait * 2) }) }, wait)
  })
}

async function download({ value, ctx, owner }: { value: FileValue; ctx: Context; owner: string | undefined }): Promise<void> {
  const locking = fileKey({ ctx, owner })
  const locked = await ctx.getFile(value.blob)
  const plain = locked && locking && hashOf(locked) === value.blob ? await unlock({ keys: locking.keys, bind: locking.bind, locked }) : null
  if (!plain) throw new HttpError(502, 'OpenHut Cloud sent a file this computer can’t open.')
  const body = Buffer.from(plain)
  if (body.length !== value.size || hashOf(body) !== value.sha) throw new HttpError(502, 'A synced file didn’t match its fingerprint.')
  await agentd.write({ id: value.agentId, path: `home/${value.path}`, body })
  shas.set(`${value.agentId}/${value.path}:${value.size}`, value.sha)
}

function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url')
}

function fileBind(workspace: string): string {
  return `workspace/${workspace}/file`
}
