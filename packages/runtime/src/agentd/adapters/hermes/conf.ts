import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, utimesSync } from 'node:fs'
import { AGENT_UID, box, conf, home, own, writeIfChanged } from '../../host.ts'
import type { SandboxSpec } from '../../sandbox/sandbox.ts'
import { isRecord } from '../../util.ts'

export const FILES = ['config.yaml', '.env', 'SOUL.md', 'auth.json'] as const
export const RESTART_KEY = 'restart.key'
export const CLAUDE_SETTINGS_FILE = 'claude-settings.json'
const CLAUDE_SETTINGS = JSON.stringify({ disableAllHooks: true, cleanupPeriodDays: 1 }) + '\n'
const MAX_FILE = 200_000

export function validateFiles(value: unknown): AgentFiles {
  if (!isRecord(value)) throw new Error('missing files')
  const files: Partial<AgentFiles> = {}
  for (const name of FILES) {
    const body = value[name]
    if (typeof body !== 'string' || body.length > MAX_FILE) throw new Error(`missing or oversized ${name}`)
    files[name] = body
  }
  if (typeof value[RESTART_KEY] === 'string') files[RESTART_KEY] = value[RESTART_KEY].slice(0, 200)
  return files as AgentFiles
}

export function writeConf(id: string, files: AgentFiles): { promptsChanged: boolean } {
  const dir = conf(id)
  mkdirSync(dir, { recursive: true })
  own({ path: dir, uid: 0, gid: AGENT_UID, mode: 0o750 })
  const had = envKeys(`${dir}/.env`)
  const changed = FILES.filter((name) => writeIfChanged(`${dir}/${name}`, files[name]))
  const key = `${dir}/${RESTART_KEY}`
  writeIfChanged(key, files[RESTART_KEY] ?? `${createHash('sha256').update(FILES.map((name) => files[name]).join('\0')).digest('hex')}\n`)
  const kept = envKeys(`${dir}/.env`)
  if ([...had].some((name) => !kept.has(name))) utimesSync(key, new Date(), new Date())
  writeIfChanged(`${dir}/${CLAUDE_SETTINGS_FILE}`, CLAUDE_SETTINGS)
  return { promptsChanged: changed.includes('SOUL.md') }
}

export async function refreshPrompts(spec: SandboxSpec): Promise<void> {
  if (!existsSync(`${home(spec.id)}/state.db`)) return
  const { code, stdout } = await box.run({ spec, command: ['sessions', 'refresh-prompts'] })
  if (code !== 0) console.error(`${spec.id}: hermes sessions refresh-prompts exited with ${code}: ${stdout.trim()}`)
}

function envKeys(path: string): Set<string> {
  return new Set(existsSync(path) ? readFileSync(path, 'utf8').split('\n').map((line) => line.split('=')[0]).filter(Boolean) : [])
}

export type AgentFiles = Record<(typeof FILES)[number], string> & { [RESTART_KEY]?: string }
