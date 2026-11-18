import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const data = mkdtempSync(join(tmpdir(), 'agentd-'))
const sock = join(data, 'agentd.sock')
const agentd = spawn(process.execPath, [fileURLToPath(new URL('../../src/agentd/agentd.ts', import.meta.url))], {
  env: { ...process.env, OPENHUT_SANDBOX: 'memory', AGENTD_DATA: data, AGENTD_SOCK: sock },
  stdio: ['ignore', 'pipe', 'inherit'],
})
after(() => {
  agentd.kill()
  rmSync(data, { recursive: true, force: true })
})
let started = ''
agentd.stdout.on('data', (chunk) => { started += chunk })
await until(() => started.includes('agentd on'))

const FILES = { 'config.yaml': 'a', '.env': 'b', 'SOUL.md': 'c', 'auth.json': 'd' }

test('a person\'s hold outlasts the runtime re-applying the agent\'s files, and ends as soon as the viewer leaves', { timeout: 10_000 }, async (t) => {
  const id = 'ag_holdap01'
  const view = await holding(id)
  t.after(() => view.destroy())
  assert.equal(policy(id), 'deny')
  assert.equal((await call({ cmd: 'apply', id, net: 1, files: FILES, browser: true, restart: true })).ok, true)
  assert.equal(policy(id), 'deny')
  view.destroy()
  await until(() => policy(id) === 'allow')
})

test('removing an agent while a person holds its browser leaves agentd running', { timeout: 10_000 }, async (t) => {
  const id = 'ag_holdrm01'
  const view = await holding(id)
  t.after(() => view.destroy())
  assert.equal((await call({ cmd: 'rm', id })).ok, true)
  view.end()
  await once(view, 'close')
  await sleep(500)
  assert.equal(agentd.exitCode, null)
  assert.equal((await call({ cmd: 'ps' })).ok, true)
})

async function holding(id: string): Promise<Socket> {
  assert.equal((await call({ cmd: 'create', id, net: 1, files: FILES, browser: true })).ok, true)
  assert.equal((await call({ cmd: 'start', id })).ok, true)
  const view = connect(sock)
  view.setEncoding('utf8')
  let lines = ''
  view.on('data', (chunk: string) => { lines += chunk })
  view.write(`${JSON.stringify({ cmd: 'browser-live', id, fps: 2 })}\n{"type":"hold","held":true}\n`)
  await until(() => lines.includes('"held":true,"mine":true'))
  return view
}

async function call(request: object): Promise<{ ok: boolean }> {
  const client = connect(sock)
  client.end(`${JSON.stringify(request)}\n`)
  let reply = ''
  for await (const chunk of client) reply += chunk
  return JSON.parse(reply)
}

function policy(id: string): string {
  try {
    return JSON.parse(readFileSync(join(data, 'agent-conf', id, 'browser-policy.json'), 'utf8')).default
  } catch {
    return ''
  }
}

async function until(done: () => boolean, ms = 5000) {
  const end = Date.now() + ms
  while (!done()) {
    if (Date.now() > end) throw new Error(`Still waiting after ${ms} ms.`)
    await sleep(20)
  }
}
