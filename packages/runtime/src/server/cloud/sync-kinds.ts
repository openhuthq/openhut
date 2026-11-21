import { createHash } from 'node:crypto'
import type { Member } from '@openhut/common/cloud/cloud.ts'
import type { FileValue, MessageValue, Opened, Synced } from '@openhut/common/cloud/record.ts'
import { PROVIDERS } from '@openhut/common/models/provider.ts'
import { fileInHome, uploadName, type ChatMessage } from '@openhut/common/threads/thread.ts'
import { concat, fromBase64, letter, lock, read, toBase64, unlock, type Bytes, type Identity } from '@openhut/common/vault/vault.ts'
import { agentService } from '../agents/agent-service.ts'
import { memoryService } from '../agents/memory-service.ts'
import { connectionService } from '../connections/connection-service.ts'
import { agentd } from '../platform/agentd.ts'
import { log, setUsageData } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { settings } from '../platform/settings.ts'
import { routineService } from '../routines/routine-service.ts'
import { threadService } from '../threads/thread-service.ts'

export type Local = { kind: Synced; ref: string; value: unknown; wire?: () => Promise<unknown>; owner?: string }
export type Context = {
  workspace: string; home: boolean; key: Bytes; version: number; keys: Record<number, Bytes>; slotKey: Bytes; me: Identity; members: Member[]; runtimes: string[]; own: Bytes | null; email: string
  putFile: (input: { hash: string; body: Bytes }) => Promise<number>; getFile: (hash: string) => Promise<Bytes | null>; again: () => void
}

const CHUNK = 1 << 20
const MAX_FILE = 32 << 20
const STAT_BATCH = 50
const CODE_PATH = /`([^`\n]{1,1024})`/g
const text = new TextEncoder()
const words = new TextDecoder()
const shas = new Map<string, string>()
const uploaded = new Map<string, string[]>()
type Owned = Map<string, string | undefined>
const uploading = new Set<string>()
const downloading = new Set<string>()

export const syncKinds = {
  async locals({ kind, admin, ctx }: { kind: Synced; admin: boolean; ctx: Context }): Promise<Local[] | null> {
    const me = toBase64(ctx.me.publicKey)
    const agents = await agentService.synced({ workspace: ctx.home ? null : ctx.workspace, owner: ctx.email })
    const owned: Owned = new Map(agents.map((agent) => [agent.id, agent.shared ? undefined : agent.owner]))
    switch (kind) {
      case 'agent': return agents.map((value) => ({ kind, ref: value.id, value, owner: owned.get(value.id) }))
      case 'setting': return admin && ctx.home ? settingLocals() : null
      case 'connection': return admin && ctx.home ? connectionLocals(ctx) : null
      case 'message': return (await threadService.synced()).filter((value) => owned.has(value.agentId)).map((value) => ({ kind, ref: value.message.id, value, owner: owned.get(value.agentId) }))
      case 'memory': {
        const here = agents.filter((agent) => agent.runsOn === me).map((agent) => agent.id)
        return (await memoryService.synced({ agentIds: here })).map((value) => ({ kind, ref: value.agentId, value, owner: owned.get(value.agentId) }))
      }
      case 'file': return fileLocals({ ctx, owned })
      case 'head': return null
    }
  },

  async hide({ open, ctx }: { open: Opened; ctx: Context }): Promise<undefined> {
    if (open.kind === 'agent' && open.owner && open.owner !== ctx.email) await agentService.hideSynced({ id: open.ref, owner: open.owner, me: ctx.email })
    return undefined
  },

  async apply({ open, ctx }: { open: Opened; ctx: Context }): Promise<unknown> {
    const author = ctx.members.find((member) => member.devices.includes(open.by))
    const by = author?.email ?? null
    switch (open.kind) {
      case 'agent': return agentService.applySynced({ id: open.ref, value: open.value, by, author, workspace: ctx.home ? null : ctx.workspace, me: ctx.email })
      case 'setting': return open.value && ctx.home ? applySetting(open.value) : undefined
      case 'message': return threadService.applySynced({ id: open.ref, value: open.value })
      case 'memory': return open.value && memoryService.applySynced(open.value)
      case 'file': return open.value ? applyFile({ value: open.value, ctx, owner: open.owner }) : undefined
      case 'head': return undefined
      case 'connection': {
        if (!ctx.home) return undefined
        const value = open.value
        if (!value) return connectionService.applySynced({ id: open.ref, value: null, by })
        const mine = value.keys.find((each) => each.to === toBase64(ctx.me.publicKey))
        const plain = mine && await read({ recipient: ctx.me, from: fromBase64(open.by), workspace: ctx.workspace, purpose: 'connection-key', body: fromBase64(mine.body), allowed: ctx.runtimes.map(fromBase64) })
        const config = plain ? objectOf(words.decode(plain)) : null
        return connectionService.applySynced({ id: value.id, value: { id: value.id, kind: value.kind, name: value.name, account: value.account, signIn: value.signIn, config }, by })
      }
    }
  },
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
        locals.push({ kind: 'file', ref, value, owner, wire: async () => wireFile({ value, ctx, owner }) })
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
  const sha = createHash('sha256').update(body).digest('base64url')
  shas.set(`${agentId}/${path}:${size}`, sha)
  return sha
}

async function wireFile({ value, ctx, owner }: { value: Omit<FileValue, 'chunks'>; ctx: Context; owner: string | undefined }): Promise<FileValue | undefined> {
  const cached = `${value.sha}:${owner ?? ''}`
  const chunks = uploaded.get(cached)
  if (chunks) return { ...value, chunks }
  if (uploading.has(cached)) return undefined
  uploading.add(cached)
  void upload({ value, ctx, owner }).then((hashes) => uploaded.set(cached, hashes), (err: unknown) => log.warn({ event: 'cloud.file_upload_failed', error: messageOf(err) }))
    .finally(() => { uploading.delete(cached); ctx.again() })
  return undefined
}

function fileKey({ ctx, owner }: { ctx: Context; owner: string | undefined }): { keys: Record<number, Bytes>; key: Bytes; bind: string } | null {
  if (!owner) return { keys: ctx.keys, key: ctx.key, bind: fileBind(ctx.workspace) }
  const own = ctx.own
  if (!own || owner !== ctx.email) return null
  return { keys: Object.fromEntries([...Object.keys(ctx.keys), String(ctx.version)].map((version) => [Number(version), own])), key: own, bind: `${fileBind(ctx.workspace)}/own/${owner}` }
}

async function upload({ value, ctx, owner }: { value: Omit<FileValue, 'chunks'>; ctx: Context; owner: string | undefined }): Promise<string[]> {
  const locking = fileKey({ ctx, owner })
  if (!locking) throw new HttpError(409, 'This computer can’t lock that private file.')
  const body = await agentd.read({ id: value.agentId, path: `home/${value.path}` })
  if (!body || createHash('sha256').update(body).digest('base64url') !== value.sha) throw new HttpError(409, 'The file changed while it was being backed up.')
  const hashes: string[] = []
  for (let start = 0; start < body.length || !hashes.length; start += CHUNK) {
    const locked = await lock({ key: locking.key, version: ctx.version, bind: locking.bind, plain: new Uint8Array(body.subarray(start, start + CHUNK)) })
    if (!locked) throw new HttpError(500, 'This computer couldn’t lock a file.')
    const hash = hashOf(locked)
    const status = await ctx.putFile({ hash, body: locked })
    if (status !== 200) throw new HttpError(502, `OpenHut Cloud refused a file (HTTP ${status}).`)
    hashes.push(hash)
  }
  return hashes
}

function applyFile({ value, ctx, owner }: { value: FileValue; ctx: Context; owner: string | undefined }): Omit<FileValue, 'chunks'> {
  const { chunks, ...local } = value
  const ref = `${value.agentId}/${value.path}`
  uploaded.set(`${value.sha}:${owner ?? ''}`, chunks)
  if (shas.get(`${ref}:${value.size}`) === value.sha) return local
  downloading.add(ref)
  void download({ value, ctx, owner }).catch((err: unknown) => log.warn({ event: 'cloud.file_download_failed', error: messageOf(err) })).finally(() => downloading.delete(ref))
  return local
}

async function download({ value, ctx, owner }: { value: FileValue; ctx: Context; owner: string | undefined }): Promise<void> {
  const parts: Bytes[] = []
  const locking = fileKey({ ctx, owner })
  for (const hash of value.chunks) {
    const locked = await ctx.getFile(hash)
    const plain = locked && locking && hashOf(locked) === hash ? await unlock({ keys: locking.keys, bind: locking.bind, locked }) : null
    if (!plain) throw new HttpError(502, 'OpenHut Cloud sent a file this computer can’t open.')
    parts.push(plain)
  }
  const body = Buffer.from(concat(parts))
  if (body.length !== value.size || createHash('sha256').update(body).digest('base64url') !== value.sha) throw new HttpError(502, 'A synced file didn’t match its fingerprint.')
  await agentd.write({ id: value.agentId, path: `home/${value.path}`, body })
  shas.set(`${value.agentId}/${value.path}:${value.size}`, value.sha)
}

export function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url')
}

function fileBind(workspace: string): string {
  return `workspace/${workspace}/file`
}

function objectOf(json: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(json)
    return typeof value === 'object' && value !== null ? { ...value } : null
  } catch {
    return null
  }
}
