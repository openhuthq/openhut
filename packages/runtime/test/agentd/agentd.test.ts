import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const data = mkdtempSync(join(tmpdir(), 'agentd-'))
const sock = join(data, 'agentd.sock')
mkdirSync(join(data, 'whatsapp-bridge', 'node_modules'), { recursive: true })
const agentd = spawn(process.execPath, [fileURLToPath(new URL('../../src/agentd/agentd.ts', import.meta.url))], {
  env: { ...process.env, OPENHUT_SANDBOX: 'memory', AGENTD_DATA: data, AGENTD_SOCK: sock, AGENTD_WHATSAPP_BRIDGE: join(data, 'whatsapp-bridge') },
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
  assert.equal((await call({ cmd: 'apply', id, net: 1, files: FILES, browser: true, running: true })).ok, true)
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

test('a delete that came by sync keeps the agent in a 30-day trash; old trash is purged', async () => {
  const id = 'ag_trashme1'
  assert.equal((await call({ cmd: 'apply', id, net: 3, files: FILES, browser: false, running: false })).ok, true)
  mkdirSync(join(data, 'trash', `${Date.now() - 31 * 24 * 60 * 60_000}-ag_oldtrash`), { recursive: true })
  assert.equal((await call({ cmd: 'rm', id, trash: true })).ok, true)
  const kept = readdirSync(join(data, 'trash'))
  assert.equal(kept.length, 1)
  assert.match(kept[0], /-ag_trashme1$/)
  assert.equal(existsSync(join(data, 'trash', kept[0], 'conf', 'SOUL.md')), true)
  assert.equal((await call({ cmd: 'ps' })).states?.[id], undefined)
})

test('sync may create the two memory files on a fresh home; any other write still needs the file to exist', async () => {
  const id = 'ag_freshmem'
  assert.equal((await call({ cmd: 'apply', id, net: 4, files: FILES, browser: false, running: false })).ok, true)
  const notes = Buffer.from('Lena prefers email.').toString('base64')
  assert.equal((await call({ cmd: 'write', id, path: 'memories/MEMORY.md' }, notes)).ok, false)
  assert.equal((await call({ cmd: 'write', id, path: 'memories/MEMORY.md', create: true }, notes)).ok, true)
  assert.equal((await call({ cmd: 'read', id, path: 'memories/MEMORY.md' })).body, notes)
  assert.equal((await call({ cmd: 'write', id, path: 'memories/OTHER.md', create: true }, notes)).ok, false)
  const again = Buffer.from('Lena prefers phone.').toString('base64')
  assert.equal((await call({ cmd: 'write', id, path: 'memories/MEMORY.md', create: true }, again)).ok, true)
  assert.equal((await call({ cmd: 'read', id, path: 'memories/MEMORY.md' })).body, again)
})

test('apply brings the sandbox to what was asked: created, started, left alone, restarted, stopped', async () => {
  const id = 'ag_applyst1'
  const apply = (more: object) => call({ cmd: 'apply', id, net: 2, files: FILES, browser: false, ...more })
  assert.equal((await apply({ running: false })).change, 'created')
  assert.equal((await call({ cmd: 'ps' })).states?.[id], 'created')
  assert.equal((await apply({ running: true })).change, 'started')
  assert.equal((await apply({ running: true })).change, 'none')
  assert.equal((await apply({ running: true, force: true })).change, 'restarted')
  assert.equal((await apply({ running: true, browser: true })).change, 'created')
  assert.equal((await call({ cmd: 'ps' })).states?.[id], 'running')
  assert.equal((await apply({ running: false, browser: true })).change, 'stopped')
})

test('WhatsApp pairing streams the bridge\'s lines, and the agent restarts when it ends', { timeout: 10_000 }, async () => {
  const id = 'ag_pairing1'
  assert.equal((await call({ cmd: 'apply', id, net: 3, files: FILES, browser: false, running: true })).ok, true)
  writeFileSync(join(data, 'agents', id, 'gateway.pid'), '1')
  const pair = connect(sock)
  pair.end(`${JSON.stringify({ cmd: 'wa-pair', id })}\n`)
  await once(pair, 'close')
  await until(() => !existsSync(join(data, 'agents', id, 'gateway.pid')))
  assert.equal((await call({ cmd: 'ps' })).states?.[id], 'running')
})

test('WhatsApp pairing on a stopped agent answers with an error', async () => {
  const id = 'ag_pairing2'
  await call({ cmd: 'apply', id, net: 4, files: FILES, browser: false, running: false })
  const reply = await call({ cmd: 'wa-pair', id })
  assert.equal(reply.ok, false)
  assert.match(String(reply.error), /isn't running/)
})

async function holding(id: string): Promise<Socket> {
  assert.equal((await call({ cmd: 'apply', id, net: 1, files: FILES, browser: true, running: true })).ok, true)
  const view = connect(sock)
  view.setEncoding('utf8')
  let lines = ''
  view.on('data', (chunk: string) => { lines += chunk })
  view.write(`${JSON.stringify({ cmd: 'browser-live', id, fps: 2 })}\n{"type":"hold","held":true}\n`)
  await until(() => lines.includes('"held":true,"mine":true'))
  return view
}

async function call(request: object, body?: string): Promise<{ ok: boolean; change?: string; error?: string; states?: Record<string, string>; body?: string | null }> {
  const client = connect(sock)
  client.end(`${JSON.stringify(request)}\n${body === undefined ? '' : `${body}\n`}`)
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
