// C1: openhut-boot on a Cloud computer. Runs the server (agentd in-process) from the pack set packs.mjs picked, the same updater
// the desktop shell uses: on the first boot it downloads and verifies one first; a pending set that isn't listening within 60 s
// rolls back to the previous one (so does one whose last boot died). In the background it fetches the next release for the next boot.
// Once the server is up, the join code is deleted from the env file (a session exists from then on, so later boots skip joining).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'
import { setTimeout as sleep } from 'node:timers/promises'
import { activePack, commit, poll, rollback } from './packs.mjs'

const HOME = process.env.OPENHUT_HOME ?? '/var/lib/openhut'
const DATA = join(HOME, 'data')
const BACKEND = process.env.OPENHUT_BACKEND ?? '/opt/openhut/backend'
const ENV_FILE = process.env.OPENHUT_ENV_FILE ?? '/etc/openhut/env'
const PORT = Number(process.env.PORT ?? 8787)
const HEALTHY_MS = Number(process.env.OPENHUT_HEALTHY_MS ?? 60_000)
const POLL_MS = 15 * 60_000
const testKey = process.env.OPENHUT_RELEASE_KEY // boot.test.ts only, as the desktop's OPENHUT_TEST_HOME
const updates = {
  home: HOME, feed: process.env.OPENHUT_UPDATE_FEED || 'https://dl.openhut.dev/', channel: 'stable',
  fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(120_000) }),
  ...testKey && { keys: { current: testKey, next: '', revoked: [] }, rekorKey: process.env.OPENHUT_REKOR_KEY },
}
const say = (event, more = {}) => console.log(JSON.stringify({ event, ...more }))
const envFile = () => existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {}

async function check() {
  try { say('boot.update', await poll(updates)) } catch (error) { say('boot.update_failed', { error: error.message }) }
}

let pack = activePack({ home: HOME, data: DATA, backend: BACKEND })
while (!pack) { // first boot: nothing to run until a signed release is downloaded and checked
  await check()
  pack = activePack({ home: HOME, data: DATA, backend: BACKEND })
  if (!pack) await sleep(10_000)
}
mkdirSync(DATA, { recursive: true })
const env = envFile()
say('boot.start', { version: pack.version, sequence: pack.sequence, pending: pack.pending, joining: !!env.OPENHUT_JOIN })
const server = spawn(process.execPath, [join(pack.app, 'packages/runtime/src/server/platform/app.mjs')], {
  cwd: pack.app, stdio: 'inherit',
  env: {
    PATH: process.env.PATH, HOME, PORT: String(PORT), OPENHUT_NAME: 'Cloud', OPENHUT_SANDBOX: 'native', OPENHUT_DATA: join(DATA, 'app'),
    AGENTD_DATA: DATA, AGENTD_ASSETS: pack.app, AGENTD_HERMES: pack.runtime, OPENHUT_BIN: pack.native, OPENHUT_CLAUDE: join(DATA, 'claude', 'claude'),
    OPENHUT_GATEWAY_PORT: '8081', OPENHUT_AGENT_HOST_NET: '1', ...env,
  },
})
let trying = pack.pending
server.on('exit', (code, signal) => {
  say('boot.server_exit', { code, signal })
  if (trying) fallBack()
  process.exit(code || 1)
})
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.kill(signal))

const up = await listening()
if (trying && !up) {
  server.kill('SIGKILL') // its exit falls back
} else if (trying) {
  trying = false
  say('boot.committed', { sequence: commit({ home: HOME, data: DATA }).current?.sequence })
}
if (up && env.OPENHUT_JOIN) {
  const { OPENHUT_JOIN, ...rest } = env
  writeFileSync(ENV_FILE, Object.entries(rest).map(([name, value]) => `${name}=${value}\n`).join(''), { mode: 0o600 })
  say('boot.join_code_deleted')
}
setTimeout(check, 30_000)
setInterval(check, POLL_MS)

// The pending set didn't come up: back to the previous set; systemd starts us again on it.
function fallBack() {
  trying = false
  rollback({ home: HOME, data: DATA })
  say('boot.fell_back', { version: pack.version, sequence: pack.sequence })
}

async function listening() {
  for (const end = Date.now() + HEALTHY_MS; Date.now() < end; await sleep(500)) {
    if (await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(2_000) }).then(() => true, () => false)) return true
  }
  return false
}
