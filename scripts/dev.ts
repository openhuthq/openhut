import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const DATA = resolve(process.env.OPENHUT_DATA ?? '.data')
const SOCK = `${DATA}/agentd.sock`
const BACKEND = resolve('packages/desktop/dist/backend')
const RUNTIME = `${BACKEND}/runtime`
const BIN = `${BACKEND}/bin/native`
const shared = { ...process.env, OPENHUT_BIN: BIN, AGENTD_HERMES: RUNTIME, AGENTD_SOCK: SOCK }

if (!existsSync(RUNTIME)) console.warn(`No agent runtime at ${RUNTIME}, so agents won't start. Run npm -w @openhut/desktop run pack-backend (needs uv).`)
rmSync(SOCK, { force: true })
const agentd = spawn(process.execPath, ['packages/runtime/src/agentd/agentd.ts'], { env: { ...shared, OPENHUT_SANDBOX: 'native', AGENTD_DATA: `${DATA}/agentd` }, stdio: 'inherit' })
while (!existsSync(SOCK) && agentd.exitCode === null) await sleep(100)
const app = spawn(process.execPath, ['--env-file-if-exists=.env', 'packages/runtime/src/server/app.ts'], {
  env: { ...shared, OPENHUT_DATA: DATA, OPENHUT_AGENT_HOST_NET: '1', OPENHUT_CLIENT_KEY_SHA256: createHash('sha256').update('dev').digest('hex') },
  stdio: 'inherit',
})
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'packages/desktop/src/renderer'], { stdio: 'inherit' })
console.log('Open http://localhost:5173 (Vite sends the dev key, `Authorization: Bearer dev`). `node scripts/seed-ui.ts` adds sample agents and connections.')
for (const child of [agentd, app, vite]) {
  child.on('exit', (code) => {
    process.exitCode ??= code ?? 0
    for (const each of [agentd, app, vite]) each.kill()
    process.exit()
  })
}
