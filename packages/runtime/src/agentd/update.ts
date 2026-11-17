import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { promisify } from 'node:util'
import { isRecord } from './util.ts'

const run = promisify(execFile)
const RELEASE_URL = process.env.OPENHUT_URL ?? 'https://openhut.dev'
const INSTALL_LOCK = '/run/openhut-install.lock'
const UPDATE_SCRIPT = 'curl -fsSL "$OPENHUT_URL" | sh'

export async function installing(): Promise<boolean> {
  return run('flock', ['-n', INSTALL_LOCK, 'true']).then(() => false, (e: unknown) => isRecord(e) && e.code === 1)
}

export async function update(): Promise<{ updating: boolean }> {
  if (await installing()) throw new Error('an install or update is already running')
  if (existsSync('/run/systemd/system')) {
    await run('systemd-run', ['--unit=openhut-update', '--collect', '--quiet', `--setenv=OPENHUT_URL=${RELEASE_URL}`, '/bin/sh', '-c', UPDATE_SCRIPT])
  } else {
    spawn('/bin/sh', ['-c', `(${UPDATE_SCRIPT}) >> /var/log/openhut-boot.log 2>&1`], { detached: true, stdio: 'ignore', env: { ...process.env, OPENHUT_URL: RELEASE_URL } }).unref()
  }
  return { updating: true }
}
