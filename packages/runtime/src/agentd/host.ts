import { chmodSync, chownSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sandboxes } from './sandbox/index.ts'

export const SOCK = process.env.AGENTD_SOCK ?? '/run/agentd/agentd.sock'
export const IMAGE = process.env.AGENT_IMAGE || readFileSync(new URL('../../../../install/agent-image', import.meta.url), 'utf8').trim()
export const APP_GID = Number(process.env.APP_GID ?? 0)
export const ASSETS = process.env.AGENTD_ASSETS || dirname(fileURLToPath(new URL('../../../../package.json', import.meta.url)))
export const DATA = resolve(process.env.AGENTD_DATA || '/data')
export const RESOLV = process.env.AGENTD_RESOLV || '/etc/agentd/resolv.conf'
export const AGENT_UID = 10000
export const AGENT_USER = `${AGENT_UID}:${AGENT_UID}`
export const AS_ROOT = process.getuid?.() === 0
export const AGENT_OWNER = AS_ROOT ? { uid: AGENT_UID, gid: AGENT_UID } : undefined
export const PIPE = process.platform === 'win32'
export const TMP_MIB = 256
export const ID = /^ag_[a-z0-9]{8}$/
export const box = await sandboxes()

export function home(id: string): string {
  return `${DATA}/agents/${id}`
}

export function realHome(id: string): string {
  return `${realpathSync(`${DATA}/agents`)}/${id}`
}

export function conf(id: string): string {
  return `${DATA}/agent-conf/${id}`
}

export function writeIfChanged(path: string, body: string): boolean {
  const changed = !existsSync(path) || readFileSync(path, 'utf8') !== body
  if (changed) writeFileSync(path, body)
  own({ path, uid: 0, gid: AGENT_UID, mode: 0o640 })
  return changed
}

export function own({ path, uid, gid, mode }: { path: string; uid: number; gid: number; mode: number }): void {
  if (!AS_ROOT) return
  chownSync(path, uid, gid)
  chmodSync(path, mode)
}
