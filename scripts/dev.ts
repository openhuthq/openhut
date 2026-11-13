import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'

const DATA = '.data'
const SOCK = `${DATA}/agentd.sock`
const SOCKET_WAIT_MS = 10_000
const env = { ...process.env, AGENTD_SOCK: SOCK, FASTMONKEY_DATA: DATA, SETUP_CODE: 'dev', FASTMONKEY_MODEL: 'test', FASTMONKEY_AGENT_API: 'http://127.0.0.1:18642' }

mkdirSync(DATA, { recursive: true })
rmSync(SOCK, { force: true })
const agentd = spawn(process.execPath, ['scripts/fake-agentd.ts'], { env, stdio: 'inherit' })
for (const end = Date.now() + SOCKET_WAIT_MS; !existsSync(SOCK); await sleep(100)) {
  if (Date.now() > end) {
    agentd.kill()
    throw new Error(`The fake agentd didn't open ${SOCK} within ${SOCKET_WAIT_MS / 1000} s`)
  }
}
const app = spawn(process.execPath, ['--env-file-if-exists=.env', 'packages/app/src/app.ts'], { env, stdio: 'inherit' })
console.log('Open http://localhost:8787/setup?code=dev. On a fresh .data, `node scripts/seed-ui.ts` adds sample people, agents and connections.')
for (const child of [agentd, app]) {
  child.on('exit', (code) => {
    process.exitCode ??= code ?? 0
    agentd.kill()
    app.kill()
  })
}
