import type { Readable, Writable } from 'node:stream'

export const AGENT_API_PORT_BASE = 18600
export type Mount = { host: string; guest: string; readOnly: boolean }
export type SandboxSpec = {
  id: string
  image: string
  cpus: number
  memoryMib: number
  user: string
  entrypoint: string
  command: string[]
  env: Record<string, string>
  mounts: Mount[]
  tmpfs: { guest: string; sizeMib: number; readOnly?: boolean }[]
  labels: Record<string, string>
  net?: number
}
export type SandboxState = { id: string; running: boolean; startedAt?: string; labels: Record<string, string> }
export type Pull = { done: number; total: number; unit: 'bytes' | 'layers' }
export type Exec = { stdin: Writable | null; stdout: Readable; exit: Promise<number>; kill: () => void }
export type Sandboxes = {
  name: 'gvisor' | 'microsandbox' | 'memory' | 'native'
  ready(): Promise<{ ok: boolean; reason?: string }>
  create(spec: SandboxSpec): Promise<void>
  start(id: string): Promise<void>
  stop(req: { id: string; seconds: number }): Promise<void>
  remove(id: string): Promise<void>
  exec(req: { id: string; command: string[]; stdin?: boolean }): Promise<Exec>
  run(req: { spec: SandboxSpec; command: string[] }): Promise<{ code: number; stdout: string }>
  list(): Promise<SandboxState[]>
  progress(): Promise<Pull | null>
}
