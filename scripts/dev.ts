import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const DATA = resolve(process.env.OPENHUT_DATA ?? '.data')
const SOCK = `${DATA}/agentd.sock`
const taken = new Set<number>()
const PORT = await freePort(Number(process.env.PORT ?? 8797))
const GATEWAY_PORT = await freePort(Number(process.env.OPENHUT_GATEWAY_PORT ?? 8091))
const LABEL = 'Dev'
const shared = { ...process.env, PORT: String(PORT), OPENHUT_GATEWAY_PORT: String(GATEWAY_PORT), AGENTD_SOCK: SOCK }

rmSync(SOCK, { force: true })
const FAKE = process.env.OPENHUT_FAKE_SANDBOX ?? String(process.platform !== 'linux')
const agentd = spawn(process.execPath, ['packages/runtime/src/agentd/agentd.ts'], { env: { ...shared, AGENTD_DATA: `${DATA}/agentd`, OPENHUT_FAKE_SANDBOX: FAKE }, stdio: 'inherit' })
while (!existsSync(SOCK) && agentd.exitCode === null) await sleep(100)
const app = spawn(process.execPath, ['--no-node-snapshot', '--env-file-if-exists=.env', 'packages/runtime/src/server/app.ts'], {
  env: { ...shared, OPENHUT_DATA: DATA, OPENHUT_DEV_KEY_SHA256: createHash('sha256').update('dev').digest('hex'), ...(FAKE === 'true' && { OPENHUT_FAKE_AGENTS: 'true', OPENHUT_MODEL: process.env.OPENHUT_MODEL ?? 'test' }) },
  stdio: 'inherit',
})
const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'packages/app', ...process.env.OPENHUT_DEV_HOST ? ['--host', process.env.OPENHUT_DEV_HOST] : []], { env: { ...shared, OPENHUT_DEV_LABEL: LABEL }, stdio: 'inherit' })
const children: ChildProcess[] = [agentd, app, vite]
console.log([
  '',
  'OpenHut Dev',
  '  App      http://localhost:5173 (or the next free port Vite prints), with the dev key',
  `  Runtime  http://127.0.0.1:${PORT}, gateway on ${GATEWAY_PORT}, data in ${DATA}`,
  FAKE === 'true' ? '  Agents   in memory (not Linux): the test model echoes replies. OPENHUT_FAKE_SANDBOX=false for Docker' : '  Agents   Docker containers (gVisor where runsc works); they start only where the agents firewall applies (Linux as root)',
  '  Reset    npm run reset wipes .data. Ctrl-C stops everything.',
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
    if (!await open(port, '127.0.0.1') || !await open(port, '0.0.0.0')) continue
    taken.add(port)
    return port
  }
}

function open(port: number, host: string): Promise<boolean> {
  return new Promise((done) => {
    const probe = createServer().once('error', () => done(false)).listen(port, host, () => probe.close(() => done(true)))
  })
}
