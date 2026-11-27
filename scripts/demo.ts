import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const DATA = mkdtempSync(join(tmpdir(), 'openhut-demo-'))
const env = { ...process.env, OPENHUT_DATA: DATA, OPENHUT_FAKE_SANDBOX: 'true', OPENHUT_FAKE_AGENTS: 'true', OPENHUT_MODEL: 'test', OPENHUT_DEV_HOST: '127.0.0.1' }
const dev = spawn(process.execPath, ['scripts/dev.ts'], { env, stdio: ['ignore', 'pipe', 'inherit'] })
let said = ''
const found = new Promise<{ runtime: string; app: string }>((resolve) => {
  dev.stdout.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk)
    said += chunk.toString().replace(/\x1b\[[0-9;]*m/g, '')
    const runtime = /Runtime\s+(http:\/\/127\.0\.0\.1:\d+)/.exec(said)?.[1]
    const app = /Local:\s+(http:\/\/\S+)/.exec(said)?.[1]
    if (runtime && app) resolve({ runtime, app })
  })
})
dev.on('exit', (code) => {
  rmSync(DATA, { recursive: true, force: true })
  process.exit(code ?? 0)
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => dev.kill(signal))

const { runtime, app } = await found
while (!await fetch(`${runtime}/health`).then(() => true, () => false)) await sleep(250)
const seed = spawn(process.execPath, ['scripts/seed-ui.ts'], { env: { ...env, PORT: new URL(runtime).port }, stdio: ['ignore', 'ignore', 'inherit'] })
await new Promise((resolve) => seed.on('exit', resolve))
console.log([
  '',
  'OpenHut demo',
  `  Open     ${app}`,
  '  Agents   Ops, Growth and Support, in memory: the test model echoes replies. No Docker, no keys.',
  `  Data     ${DATA}, deleted when this stops. Ctrl-C stops it.`,
  '',
].join('\n'))
