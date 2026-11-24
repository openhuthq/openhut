import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const DATA = resolve(process.env.OPENHUT_DATA ?? '.data')
const SOCK = `${DATA}/agentd.sock`
const BACKEND = resolve('packages/desktop/dist/backend')
const RUNTIME = `${BACKEND}/runtime`
const BIN = `${BACKEND}/bin/native`
const taken = new Set<number>()
const PORT = await freePort(Number(process.env.PORT ?? 8797))
const GATEWAY_PORT = await freePort(Number(process.env.OPENHUT_GATEWAY_PORT ?? 8091))
const REMOTE_CLOUD = process.env.OPENHUT_CLOUD_URL
const LOCAL_CLOUD = !REMOTE_CLOUD

if (LOCAL_CLOUD && !existsSync('private/api/node_modules')) {
  console.error('npm run dev runs the cloud locally from private/api, and it isn\'t checked out and installed here. Run npm install with access to openhuthq/openhut-private, or set OPENHUT_CLOUD_URL and OPENHUT_API_URL to a cloud you mean to use.')
  process.exit(1)
}
const API_PORT = LOCAL_CLOUD ? await freePort(Number(process.env.OPENHUT_API_PORT ?? 8792)) : 0
const CLOUD_URL = REMOTE_CLOUD ?? `http://127.0.0.1:${API_PORT}`
const API_URL = process.env.OPENHUT_API_URL ?? (LOCAL_CLOUD ? CLOUD_URL : 'https://cloud.openhut.dev/api')
const LABEL = LOCAL_CLOUD ? 'Dev · local cloud' : `Dev · ${new URL(CLOUD_URL).hostname}`
const shared = { ...process.env, PORT: String(PORT), OPENHUT_GATEWAY_PORT: String(GATEWAY_PORT), OPENHUT_BIN: BIN, AGENTD_HERMES: RUNTIME, AGENTD_SOCK: SOCK, OPENHUT_CLOUD_URL: CLOUD_URL, OPENHUT_API_URL: API_URL, OPENHUT_PERSONAL: '1' }

if (!existsSync(RUNTIME)) console.warn(`No agent runtime at ${RUNTIME}, so agents won't start. Run npm -w @openhut/desktop run pack-backend (needs uv).`)
const children: ChildProcess[] = []
if (LOCAL_CLOUD) {
  children.push(spawn(process.execPath, ['src/server.ts'], { cwd: 'private/api', env: { ...process.env, PORT: String(API_PORT), OPENHUT_API_DATA: `${DATA}/api`, DEV_SIGN_IN: '1' }, stdio: 'inherit' }))
}
rmSync(SOCK, { force: true })
const agentd = spawn(process.execPath, ['packages/runtime/src/agentd/agentd.ts'], { env: { ...shared, OPENHUT_SANDBOX: 'native', AGENTD_DATA: `${DATA}/agentd` }, stdio: 'inherit' })
while (!existsSync(SOCK) && agentd.exitCode === null) await sleep(100)
const app = spawn(process.execPath, ['--env-file-if-exists=.env', 'packages/runtime/src/server/app.ts'], {
  env: { ...shared, OPENHUT_DATA: DATA, OPENHUT_AGENT_HOST_NET: '1', OPENHUT_CLIENT_KEY_SHA256: createHash('sha256').update('dev').digest('hex') },
  stdio: 'inherit',
})
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'packages/desktop/src/renderer'], { env: { ...shared, VITE_OPENHUT_DEV: LABEL }, stdio: 'inherit' })
children.push(agentd, app, vite)
console.log([
  '',
  `OpenHut Dev (${LABEL})`,
  '  App      http://localhost:5173 (or the next free port Vite prints), with the dev key',
  `  Runtime  http://127.0.0.1:${PORT}, gateway on ${GATEWAY_PORT}, data in ${DATA}`,
  `  Cloud    ${API_URL} (one process: API, relay, OAuth broker; PGlite in ${DATA}/api)`,
  LOCAL_CLOUD ? '  Sign in  pick mo@example.com on the dev sign-in page (no Google)' : '  Sign in  with the cloud above',
  '  Reset    npm run reset wipes .data (runtime and local cloud DB). Ctrl-C stops everything.',
  '',
].join('\n'))
for (const child of children) child.on('exit', (code) => stop(code ?? 0))
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => stop(0))

function stop(code: number) {
  process.exitCode ??= code
  for (const each of children) each.kill()
  process.exit()
}

async function freePort(from: number): Promise<number> {
  for (let port = from; ; port++) {
    if (taken.has(port)) continue
    const free = await new Promise<boolean>((done) => {
      const probe = createServer().once('error', () => done(false)).listen(port, '127.0.0.1', () => probe.close(() => done(true)))
    })
    if (!free) continue
    taken.add(port)
    return port
  }
}
