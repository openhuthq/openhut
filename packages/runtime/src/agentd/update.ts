import { execFile, spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { isRecord } from './util.ts'

const run = promisify(execFile)
const RELEASE_URL = process.env.OPENHUT_URL ?? 'https://openhut.dev'
const INSTALL_LOCK = '/run/openhut-install.lock'
const LOG = join(resolve(process.env.AGENTD_DATA || '/data'), 'update.log')
const EXIT = `${LOG}.exit`
const REQUEST = join(resolve(process.env.AGENTD_DATA || '/data'), 'update.request')
const IN_IMAGE = process.env.OPENHUT_RUNTIME === 'image'
export const UPDATE_SCRIPT = `exec >"$LOG" 2>&1; rm -f "$EXIT"; f=$(mktemp)
if ! curl -fsSL --retry 3 "$OPENHUT_URL" -o "$f"; then echo "openhut: couldn't download the release from $OPENHUT_URL"; code=2
elif ! printf '%s  %s\\n' "$OPENHUT_SHA256" "$f" | sha256sum -c - >/dev/null 2>&1; then echo "openhut: a newer release came out after this update was checked. Check for updates again."; code=3
else sh "$f"; code=$?; fi
rm -f "$f"; echo "$code" > "$EXIT"`

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
  if (IN_IMAGE) {
    writeFileSync(REQUEST, `${sha256} ${appVersion}\n`)
    return { updating: true }
  }
  const env = { OPENHUT_URL: RELEASE_URL, OPENHUT_APP_VERSION: appVersion, OPENHUT_SHA256: sha256, LOG, EXIT }
  if (existsSync('/run/systemd/system')) {
    await run('systemd-run', ['--unit=openhut-update', '--collect', '--quiet', ...Object.entries(env).map(([name, value]) => `--setenv=${name}=${value}`), '/bin/sh', '-c', UPDATE_SCRIPT])
  } else {
    spawn('/bin/sh', ['-c', UPDATE_SCRIPT], { detached: true, stdio: 'ignore', env: { ...process.env, ...env } }).unref()
  }
  return { updating: true }
}
