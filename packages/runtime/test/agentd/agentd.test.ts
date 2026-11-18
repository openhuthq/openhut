import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'

const data = mkdtempSync(join(tmpdir(), 'agentd-'))
Object.assign(process.env, { OPENHUT_SANDBOX: 'memory', AGENTD_DATA: data, AGENTD_SOCK: join(data, 'agentd.sock') })
const { server } = await import('../../src/agentd/agentd.ts')
if (!server.listening) await once(server, 'listening')
after(() => {
  server.close()
  rmSync(data, { recursive: true, force: true })
})

const FILES = { 'config.yaml': 'a', '.env': 'b', 'SOUL.md': 'c', 'auth.json': 'd' }

test('a person\'s hold outlasts the runtime re-applying the agent\'s files, and ends as soon as the viewer leaves', { timeout: 10_000 }, async () => {
  const id = 'ag_holdap01'
  const view = await holding(id)
  assert.equal(policy(id), 'deny')
  assert.equal((await call({ cmd: 'apply', id, net: 1, files: FILES, browser: true, restart: true })).ok, true)
  assert.equal(policy(id), 'deny')
  view.destroy()
  await until(() => policy(id) === 'allow')
})

test('removing an agent while a person holds its browser leaves agentd running', { timeout: 10_000 }, async () => {
  const id = 'ag_holdrm01'
  const view = await holding(id)
  assert.equal((await call({ cmd: 'rm', id })).ok, true)
  view.end()
  await once(view, 'close')
  await sleep(500)
  assert.equal((await call({ cmd: 'ps' })).ok, true)
})

async function holding(id: string): Promise<Socket> {
  assert.equal((await call({ cmd: 'create', id, net: 1, files: FILES, browser: true })).ok, true)
  assert.equal((await call({ cmd: 'start', id })).ok, true)
  const view = connect(join(data, 'agentd.sock'))
  view.setEncoding('utf8')
  let lines = ''
  view.on('data', (chunk: string) => { lines += chunk })
  view.write(`${JSON.stringify({ cmd: 'browser-live', id, fps: 2 })}\n{"type":"hold","held":true}\n`)
  await until(() => lines.includes('"held":true,"mine":true'))
  return view
}

async function call(request: object): Promise<{ ok: boolean }> {
  const sock = connect(join(data, 'agentd.sock'))
  sock.end(`${JSON.stringify(request)}\n`)
  let reply = ''
  for await (const chunk of sock) reply += chunk
  return JSON.parse(reply)
}

function policy(id: string): string {
  return JSON.parse(readFileSync(join(data, 'agent-conf', id, 'browser-policy.json'), 'utf8')).default
}

async function until(done: () => boolean) {
  while (!done()) await sleep(20)
}
