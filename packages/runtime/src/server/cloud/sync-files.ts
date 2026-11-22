import { createHash } from 'node:crypto'
import type { FileValue } from '@openhut/common/cloud/record.ts'
import { fileInHome, uploadName, type ChatMessage } from '@openhut/common/threads/thread.ts'
import { lock, unlock, type Bytes } from '@openhut/common/vault/vault.ts'
import { agentd } from '../platform/agentd.ts'
import { log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { threadService } from '../threads/thread-service.ts'
import type { Context, Local } from './sync-kinds.ts'

export type Owned = Map<string, string | undefined>

const MAX_FILE = 32 << 20
const STAT_BATCH = 50
const AGAIN_MS = 30_000
const RETRY_MS = 2000
const RETRY_MAX_MS = 5 * 60_000
const CODE_PATH = /`([^`\n]{1,1024})`/g
const shas = new Map<string, string>()
const uploaded = new Map<string, string>()
const uploading = new Set<string>()
const downloading = new Map<string, FileValue>()

export async function fileLocals({ ctx, owned }: { ctx: Context; owned: Owned }): Promise<Local[]> {
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

export function applyFile({ value, ctx, owner }: { value: FileValue; ctx: Context; owner: string | undefined }): undefined {
  const { blob, ...local } = value
  const ref = `${value.agentId}/${value.path}`
  uploaded.set(`${value.sha}:${owner ?? ''}`, blob)
  if (shas.get(`${ref}:${value.size}`) === value.sha) ctx.landed({ kind: 'file', ref, value: local, owner })
  else if (downloading.get(ref)?.blob !== blob) fetchFile({ value, ctx, owner, wait: RETRY_MS })
  return undefined
}

export function forgetUpload(blob: string): void {
  for (const [cached, hash] of uploaded) if (hash === blob) uploaded.delete(cached)
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
  if (!locking) throw new HttpError(409, 'Couldn’t back up a file. OpenHut tries again.')
  const body = await agentd.read({ id: value.agentId, path: `home/${value.path}` })
  if (!body || hashOf(body) !== value.sha) throw new HttpError(409, 'The file changed while it was being backed up.')
  const locked = await lock({ key: locking.key, version: ctx.version, bind: locking.bind, plain: new Uint8Array(body) })
  if (!locked) throw new HttpError(500, 'Couldn’t back up a file. OpenHut tries again.')
  const hash = hashOf(locked)
  const status = await ctx.putFile({ hash, body: locked })
  if (status !== 200) throw new HttpError(502, 'OpenHut Cloud couldn’t save a backup. OpenHut tries again.')
  return hash
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
  if (body.length !== value.size || hashOf(body) !== value.sha) throw new HttpError(502, 'A file didn’t come back intact. OpenHut tries again.')
  const saved = await agentd.write({ id: value.agentId, path: `home/${value.path}`, body, replace: true })
  if (saved.path !== `home/${value.path}`) throw new HttpError(502, `A synced file was saved as ${saved.path}, not ${value.path}.`)
  shas.set(`${value.agentId}/${value.path}:${value.size}`, value.sha)
}

function hashOf(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('base64url')
}

function fileBind(workspace: string): string {
  return `workspace/${workspace}/file`
}
