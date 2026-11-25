import { chmodSync, chownSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sandboxes } from './sandbox/index.ts'
import { config } from './config.ts'

export const SOCK = config.socket
export const IMAGE = config.image
export const APP_GID = gidOf('openhut')
export const ASSETS = config.assets
export const DATA = config.data
export const BIN = config.bin
export const CLAUDE = join(BIN, 'claude')
export const RESOLV = '/etc/agentd/resolv.conf'
export const AGENT_UID = 10000
export const AGENT_USER = `${AGENT_UID}:${AGENT_UID}`
export const AS_ROOT = process.getuid?.() === 0
export const AGENT_OWNER = AS_ROOT ? { uid: AGENT_UID, gid: AGENT_UID } : undefined
export const TMP_MIB = 256
export const ID = /^ag_[a-z0-9]{8}$/
export const box = sandboxes

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

function gidOf(user: string): number {
  try { return Number(new RegExp(`^${user}:[^:]*:\\d+:(\\d+):`, 'm').exec(readFileSync('/etc/passwd', 'utf8'))?.[1] ?? 0) } catch { return 0 }
}
