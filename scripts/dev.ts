import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const DATA = resolve(process.env.OPENHUT_DATA ?? '.data')
const SOCK = `${DATA}/agentd.sock`
const BACKEND = resolve('packages/desktop/dist/backend')
const RUNTIME = `${BACKEND}/runtime`
const BIN = `${BACKEND}/bin/native`
const CLOUD_PORT = process.env.OPENHUT_CLOUD_PORT ?? '8790'
const LOCAL_CLOUD = !process.env.OPENHUT_CLOUD_URL && existsSync('private/cloud/package.json')
const CLOUD_URL = process.env.OPENHUT_CLOUD_URL ?? (LOCAL_CLOUD ? `http://127.0.0.1:${CLOUD_PORT}` : undefined)
const shared = { ...process.env, OPENHUT_BIN: BIN, AGENTD_HERMES: RUNTIME, AGENTD_SOCK: SOCK, ...CLOUD_URL && { OPENHUT_CLOUD_URL: CLOUD_URL } }

if (!existsSync(RUNTIME)) console.warn(`No agent runtime at ${RUNTIME}, so agents won't start. Run npm -w @openhut/desktop run pack-backend (needs uv).`)
if (!CLOUD_URL) console.warn('No private/cloud and no OPENHUT_CLOUD_URL, so sign-in goes to cloud.openhut.dev.')
const children: ChildProcess[] = []
if (LOCAL_CLOUD) {
  const state = `${DATA}/cloud`
  const wrangler = { cwd: 'private/cloud', env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } }
  spawnSync('node_modules/.bin/wrangler', ['d1', 'migrations', 'apply', 'openhut-stats', '--local', '--persist-to', state], { ...wrangler, stdio: 'ignore' })
  children.push(spawn('npm', ['run', 'dev', '--', '--port', CLOUD_PORT, '--inspector-port', '0', '--persist-to', state, '--var', `AUTH_URL:${CLOUD_URL}`, '--show-interactive-dev-session=false', '--log-level', 'warn'], { ...wrangler, stdio: 'inherit' }))
}
rmSync(SOCK, { force: true })
const agentd = spawn(process.execPath, ['packages/runtime/src/agentd/agentd.ts'], { env: { ...shared, OPENHUT_SANDBOX: 'native', AGENTD_DATA: `${DATA}/agentd` }, stdio: 'inherit' })
while (!existsSync(SOCK) && agentd.exitCode === null) await sleep(100)
const app = spawn(process.execPath, ['--env-file-if-exists=.env', 'packages/runtime/src/server/app.ts'], {
  env: { ...shared, OPENHUT_DATA: DATA, OPENHUT_AGENT_HOST_NET: '1', OPENHUT_CLIENT_KEY_SHA256: createHash('sha256').update('dev').digest('hex') },
  stdio: 'inherit',
})
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'packages/desktop/src/renderer'], { stdio: 'inherit' })
children.push(agentd, app, vite)
console.log(`Open http://localhost:5173 (Vite sends the dev key, \`Authorization: Bearer dev\`).${LOCAL_CLOUD ? ` Sign-in goes to the dev cloud on ${CLOUD_URL}, which lists test emails instead of Google.` : ''} \`node scripts/seed-ui.ts\` signs in and adds sample agents and connections.`)
for (const child of children) {
  child.on('exit', (code) => {
    process.exitCode ??= code ?? 0
    for (const each of children) each.kill()
    process.exit()
  })
}
