import { chmodSync, chownSync, existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.ts'
import { docker } from './sandbox/docker.ts'
import { memory } from './sandbox/memory.ts'
import type { Mount, Sandboxes, SandboxSpec } from './sandbox/sandbox.ts'

export const APP_GID = gidOf('openhut')
export const CLAUDE = join(config.bin, 'claude')
export const AGENT_UID = 10000
export const AGENT_USER = `${AGENT_UID}:${AGENT_UID}`
export const AS_ROOT = process.getuid?.() === 0
export const AGENT_OWNER = AS_ROOT ? { uid: AGENT_UID, gid: AGENT_UID } : undefined
export const TMP_MIB = 256
export const box: Sandboxes = config.fakeSandbox ? memory : docker

export function home(id: string): string {
  return `${config.data}/agents/${id}`
}

export function realHome(id: string): string {
  return `${realpathSync(`${config.data}/agents`)}/${id}`
}

export function conf(id: string): string {
  return `${config.data}/agent-conf/${id}`
}

export function scratchSpec({ id, mounts, tmpfs }: { id: string; mounts: Mount[]; tmpfs: SandboxSpec['tmpfs'] }): Omit<SandboxSpec, 'entrypoint' | 'command'> {
  return { id, image: config.image, cpus: 1, memoryMib: TMP_MIB, user: AGENT_USER, env: {}, mounts, tmpfs, labels: {} }
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
