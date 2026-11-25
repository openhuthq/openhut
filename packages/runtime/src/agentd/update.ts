import { execFile } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { isRecord } from './util.ts'
import { config } from './config.ts'

const run = promisify(execFile)
const INSTALL_LOCK = '/run/openhut-install.lock'
const LOG = join(config.data, 'update.log')
const EXIT = `${LOG}.exit`
const REQUEST = join(config.data, 'update.request')

export type LastUpdate = { exit: number; at: string; reason: string | null }

export async function installing(): Promise<boolean> {
  return run('flock', ['-n', INSTALL_LOCK, 'true']).then(() => false, (e: unknown) => isRecord(e) && e.code === 1)
}

export function lastUpdate(): LastUpdate | null {
  if (!existsSync(EXIT)) return null
  const exit = Number.parseInt(readFileSync(EXIT, 'utf8'), 10)
  const lines = existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').map((line) => line.trim()).filter(Boolean) : []
  const said = lines.findLast((line) => line.startsWith('openhut: '))?.slice('openhut: '.length) ?? null
  return { exit: Number.isFinite(exit) ? exit : -1, at: statSync(EXIT).mtime.toISOString(), reason: exit === 0 ? null : said ?? lines.at(-1) ?? null }
}

export async function update({ appVersion = '', sha256 }: { appVersion?: string; sha256: string }): Promise<{ updating: boolean }> {
  if (await installing()) throw new Error('an install or update is already running')
  writeFileSync(REQUEST, `${sha256} ${appVersion}\n`)
  return { updating: true }
}
