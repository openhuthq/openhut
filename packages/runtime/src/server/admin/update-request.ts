import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { HttpError } from '../platform/http-error.ts'
import { config } from '../platform/config.ts'

const run = promisify(execFile)
const INSTALL_LOCK = join(config.installDir, 'install.lock')
const LOG = join(config.installDir, 'update.log')
const EXIT = `${LOG}.exit`
const REQUEST = join(config.installDir, 'update', 'request')

export type LastUpdate = { exit: number; at: string; reason: string | null }

export async function installing(): Promise<boolean> {
  return run('flock', ['-n', INSTALL_LOCK, 'true']).then(() => false, (e: unknown) => typeof e === 'object' && e !== null && 'code' in e && e.code === 1)
}

export function lastUpdate(): LastUpdate | null {
  if (!existsSync(EXIT)) return null
  const exit = Number.parseInt(readFileSync(EXIT, 'utf8'), 10)
  const lines = existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean) : []
  const said = lines.findLast((line) => line.startsWith('openhut: '))?.slice('openhut: '.length) ?? null
  return { exit: Number.isFinite(exit) ? exit : -1, at: statSync(EXIT).mtime.toISOString(), reason: exit === 0 ? null : said ?? lines.at(-1) ?? null }
}

export async function request({ appVersion = '', sha256 }: { appVersion?: string; sha256: string }): Promise<{ updating: boolean }> {
  if (await installing()) throw new HttpError(409, 'An install or update is already running. Try again when it finishes.')
  mkdirSync(join(config.installDir, 'update'), { recursive: true })
  rmSync(REQUEST, { force: true })
  writeFileSync(REQUEST, `${sha256} ${appVersion}\n`)
  chmodSync(REQUEST, 0o666)
  return { updating: true }
}
