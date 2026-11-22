import assert from 'node:assert/strict'
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { promisify } from 'node:util'
import type { CheckResult, PhaseResults } from './e2e.ts'

const RESULTS = process.env.RESULTS ?? 'packages/e2e/results'
const CLOUD = process.env.CLOUD_URL ?? 'http://127.0.0.1:8790'
const CLOUD_STATE = process.env.CLOUD_STATE ?? `${RESULTS}/cloud-state`
const REMOTE = process.env.REMOTE_URL ?? 'http://127.0.0.1:8787'
const REMOTE_KEY = process.env.OPENHUT_E2E_KEY ?? ''
const REMOTE_CONTAINER = process.env.REMOTE_CONTAINER
const HOST_PORT = Number(process.env.HOST_PORT ?? 8840)
const tag = randomBytes(6).toString('hex')
const SECRET = `e2e-${randomBytes(9).toString('hex')}`
const CANARIES = {
  agent: `Zebra Desk ${tag}`,
  instructions: `Answer refunds for order ${tag}-4471 politely.`,
  messages: [`Where is parcel ${tag}-A?`, `Is parcel ${tag}-B late?`, `After the restart, parcel ${tag}-C?`],
  reply: `Parcel ${tag}-R is in Berlin.`,
  connection: `Cloud Orders ${tag}`,
  connectionKey: SECRET,
}
const results: CheckResult[] = []

type Call = (path: string, body?: unknown, method?: string) => Promise<Record<string, unknown>>
type Runtime = { call: Call; restart: () => Promise<void>; stop: () => void }
type Status = { status: string; email: string | null; device: string | null; workspace: { id: string; members: { email: string; devices: string[] }[] } | null; backup: { state: string; done: number; total: number; at: string | null }; kitInCloud: boolean; workspaces: { id: string; waiting: boolean; members: { email: string }[] }[]; gone: { name: string; why: string }[] }

const hermes = createServer((req, res) => {
  req.resume().on('end', () => {
    if (req.url?.endsWith('/models')) return res.writeHead(200, { 'content-type': 'application/json' }).end('{"object":"list","data":[{"id":"hermes-agent"}]}')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: CANARIES.reply } }] })}\n\n`)
    res.end('data: [DONE]\n\n')
  })
}).listen(0, '127.0.0.1')
await once(hermes, 'listening')
const HERMES = `http://127.0.0.1:${(hermes.address() as AddressInfo).port}`

const runtimes: Runtime[] = []
const host = runtime({ name: 'host', port: HOST_PORT })
const restored = runtime({ name: 'restored', port: HOST_PORT + 2 })
const sara = runtime({ name: 'sara', port: HOST_PORT + 4 })
const remote = REMOTE_CONTAINER ? inContainer(REMOTE_CONTAINER) : call(REMOTE, REMOTE_KEY)

after(() => {
  for (const each of runtimes) each.stop()
  hermes.close()
  writeFileSync(`${RESULTS}/cloud-canaries.json`, JSON.stringify(CANARIES, null, 2))
  const passed = results.filter((r) => r.pass).length
  const report: PhaseResults = { phase: 'cloud', at: new Date().toISOString(), passed, failed: results.length - passed, results }
  writeFileSync(`${RESULTS}/e2e-cloud.json`, JSON.stringify(report, null, 2))
  console.log(`\n${passed}/${results.length} passed -> ${RESULTS}/e2e-cloud.json`)
})

function runtime({ name, port }: { name: string; port: number }): Runtime {
  const data = mkdtempSync(join(tmpdir(), `openhut-e2e-${name}-`))
  mkdirSync(join(data, 'agentd'))
  const sock = join(data, 'agentd.sock')
  let children: ChildProcess[] = []
  const start = () => {
    children = [
      spawn(process.execPath, ['packages/runtime/src/agentd/agentd.ts'], { stdio: ['ignore', 'ignore', 'inherit'], env: { ...process.env, OPENHUT_SANDBOX: 'memory', AGENTD_DATA: join(data, 'agentd'), AGENTD_SOCK: sock } }),
      spawn(process.execPath, ['packages/runtime/src/server/app.ts'], {
        stdio: ['ignore', 'ignore', 'inherit'],
        env: {
          ...process.env, PORT: String(port), OPENHUT_DATA: data, OPENHUT_CLOUD_URL: CLOUD, OPENHUT_MODEL: 'test', AGENTD_SOCK: sock, OPENHUT_AGENT_API: HERMES,
          OPENHUT_GATEWAY_PORT: String(port + 1), OPENHUT_CLIENT_KEY_SHA256: createHash('sha256').update('host').digest('hex'),
        },
      }),
    ]
  }
  const stop = () => {
    for (const child of children) child.kill()
  }
  start()
  const each: Runtime = {
    call: call(`http://127.0.0.1:${port}`, 'host'),
    stop,
    restart: async () => {
      const exited = children.map((child) => child.exitCode === null ? once(child, 'exit') : Promise.resolve())
      stop()
      await Promise.all(exited)
      start()
    },
  }
  runtimes.push(each)
  return each
}

function call(base: string, key: string): Call {
  return async (path, body, method) => {
    const res = await fetch(`${base}${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: { authorization: `Bearer ${key}`, ...(body !== undefined && { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    const json = (() => { try { return JSON.parse(text) as Record<string, unknown> } catch { return { text } } })()
    if (!res.ok) throw new Error(`${path} answered ${res.status}: ${text.slice(0, 300)}`)
    return json
  }
}

function inContainer(name: string): Call {
  return async (path, body) => {
    const json = body === undefined ? [] : ['-d', JSON.stringify(body)]
    const { stdout } = await promisify(execFile)('docker', ['exec', name, 'curl', '-s', '-w', '\n%{http_code}', '-H', `authorization: Bearer ${REMOTE_KEY}`, '-H', 'content-type: application/json', ...json, `${REMOTE}${path}`])
    const status = Number(stdout.slice(stdout.lastIndexOf('\n') + 1))
    const reply = JSON.parse(stdout.slice(0, stdout.lastIndexOf('\n')) || '{}') as Record<string, unknown>
    if (status < 200 || status > 299) throw new Error(`${path} answered ${status}: ${JSON.stringify(reply)}`)
    return reply
  }
}

async function until<T>(read: () => Promise<T | undefined | false>, what: string, ms = 60_000): Promise<T> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    const value = await read().catch(() => undefined)
    if (value !== undefined && value !== false) return value
  }
  throw new Error(`timed out waiting for ${what}`)
}

const status = (each: Runtime) => each.call('/api/cloud') as Promise<Status>
const statusUntil = (each: Runtime, ok: (s: Status) => boolean, what: string) => until(async () => { const s = await status(each); return ok(s) && s }, what)

async function signIn(each: Runtime, email: string) {
  await until(() => each.call('/api/cloud').then(() => true), 'the runtime to answer')
  const { authorizationUrl } = await each.call('/api/cloud/sessions', {}) as { authorizationUrl: string }
  let url = authorizationUrl
  for (let hop = 0; hop < 5 && !url.includes('/v1/dev/sign-in'); hop++) url = new URL((await fetch(url, { redirect: 'manual' })).headers.get('location') ?? '', url).href
  const page = await (await fetch(url)).text()
  const link = new RegExp(`href="([^"]+)">${email}<`).exec(page)?.[1]?.replaceAll('&amp;', '&') ?? ''
  assert.ok(link, `the dev sign-in page offers ${email}`)
  await fetch(link)
}

async function say(each: Runtime, { agentId, text }: { agentId: string; text: string }) {
  const threads = await each.call('/api/threads') as { data: { id: string; agentId: string }[] }
  const thread = threads.data.find((t) => t.agentId === agentId) ?? await each.call('/api/threads', { agentId }) as { id: string }
  await each.call(`/api/threads/${thread.id}/chat`, { trigger: 'submit-message', message: { id: `msg_${randomBytes(6).toString('hex')}`, role: 'user', parts: [{ type: 'text', text }] } })
}

async function said(each: Runtime, agentId: string): Promise<string> {
  const threads = await each.call('/api/threads') as { data: { id: string; agentId: string }[] }
  const texts = await Promise.all(threads.data.filter((t) => t.agentId === agentId).map(async (t) => JSON.stringify((await each.call(`/api/threads/${t.id}`)).messages ?? [])))
  return texts.join('\n')
}

function check(id: string, name: string, expected: string, fn: () => Promise<string>) {
  test(`${id} ${name}`, async () => {
    try {
      results.push({ id, check: name, expected, actual: await fn(), pass: true })
    } catch (error) {
      results.push({ id, check: name, expected, actual: error instanceof Error ? error.message : String(error), pass: false })
      throw error
    }
  })
}

const state = { workspace: '', device: '', agent: '', words: [] as string[] }

check('Y1', 'The Mac signs in to the cloud room', 'host runtime: cloud on, owner mo@example.com', async () => {
  await signIn(host, 'mo@example.com')
  const cloud = await statusUntil(host, (s) => s.status === 'on' && !!s.workspace, 'the host cloud to be on')
  assert.equal(cloud.email, 'mo@example.com')
  Object.assign(state, { workspace: cloud.workspace?.id, device: cloud.device })
  return `status ${cloud.status}, ${cloud.email}`
})

check('Y2', 'The remote runtime joins as a device on the member list and signs in with its own key', 'remote cloud on; its device is on the list under mo@example.com', async () => {
  const before = await remote('/api/cloud') as { status: string; device: string }
  assert.equal(before.status, 'off')
  const invite = await host.call('/api/cloud/runtimes', { device: before.device })
  await remote('/api/cloud/join', invite)
  const cloud = await until(async () => { const each = await remote('/api/cloud') as Status; return each.status === 'on' && each }, 'the remote to be on')
  const owner = cloud.workspace?.members.find((member) => member.devices.includes(before.device))
  assert.equal(owner?.email, 'mo@example.com')
  return `remote ${cloud.status}, listed under ${owner?.email}`
})

check('Y3', 'A connection added on the Mac reaches the remote runtime with its key', 'remote lists the connection with keyHere true', async () => {
  await host.call('/api/connections', { kind: 'postgres', name: CANARIES.connection, dsn: `postgres://app:${SECRET}@db.invalid/orders` })
  const found = await until(async () => {
    const { data } = await remote('/api/connections') as { data: { name: string; keyHere: boolean }[] }
    return data.find((each) => each.name === CANARIES.connection && each.keyHere)
  }, 'the connection on the remote')
  return `${found.name}, keyHere ${found.keyHere}`
})

check('Y4', 'Back up: an agent, its chat and a recovery kit reach the room', 'agent running and answering; kit saved in the cloud; backup idle with everything sent', async () => {
  const agent = await host.call('/api/agents', { name: CANARIES.agent, instructions: CANARIES.instructions }) as { id: string }
  state.agent = agent.id
  await host.call(`/api/agents/${agent.id}`, { wanted: 'running' }, 'PATCH')
  await until(async () => (await host.call(`/api/agents/${agent.id}`)).status === 'running', 'the agent to run')
  await say(host, { agentId: agent.id, text: CANARIES.messages[0] })
  await say(host, { agentId: agent.id, text: CANARIES.messages[1] })
  assert.ok((await said(host, agent.id)).includes(CANARIES.reply), 'the agent answered')
  const kit = await host.call('/api/cloud/kits', {}) as { words: string[] }
  state.words = kit.words
  const cloud = await statusUntil(host, (s) => s.backup.state === 'idle' && !!s.backup.at && s.kitInCloud, 'the backup to finish')
  return `${kit.words.length} words; backup ${cloud.backup.state} ${cloud.backup.done}/${cloud.backup.total} at ${cloud.backup.at}`
})

check('Y5', 'Restore on a fresh runtime with the kit', 'fresh runtime: signed in as mo it is locked; the 12 words open it; the same agent id, name, instructions and chat come back', async () => {
  await signIn(restored, 'mo@example.com')
  const locked = await statusUntil(restored, (s) => s.status === 'locked', 'the fresh runtime to ask for the kit')
  await restored.call('/api/cloud/unlock', { words: state.words })
  const on = await statusUntil(restored, (s) => s.status === 'on' && s.workspace?.id === state.workspace, 'the restore to land in the same workspace')
  const agent = await until(async () => { const each = await restored.call(`/api/agents/${state.agent}`); return each.name === CANARIES.agent && each }, 'the agent on the restored runtime')
  assert.equal(agent.instructions, CANARIES.instructions)
  const chat = await until(async () => { const text = await said(restored, state.agent); return CANARIES.messages.slice(0, 2).every((m) => text.includes(m)) && text.includes(CANARIES.reply) && text }, 'the chat on the restored runtime')
  return `${locked.status} -> ${on.status}; ${String(agent.name)} (${state.agent}), instructions match, chat ${chat.length} bytes with both messages and the reply`
})

check('Y6', 'An invite and a join', 'sara signs in on her own runtime, mo invites her as a member, she joins and both see her on the member list', async () => {
  await signIn(sara, 'sara@example.com')
  await statusUntil(sara, (s) => s.status === 'on', 'sara to be on')
  const invite = await host.call('/api/invitations/cloud', { workspace: state.workspace, email: 'sara@example.com', role: 'member' }) as { link: string }
  await sara.call('/api/invitations/cloud/joins', { link: invite.link })
  await statusUntil(host, (s) => !!s.workspaces.find((w) => w.id === state.workspace)?.members.some((m) => m.email === 'sara@example.com'), 'mo to see sara')
  const joined = await statusUntil(sara, (s) => s.workspaces.some((w) => w.id === state.workspace && !w.waiting), 'sara to get the workspace key')
  return `sara in ${joined.workspaces.length} workspaces, mo's workspace ready`
})

check('Y7', 'A remove cuts sara off', 'mo removes sara; she is off mo\'s member list and her runtime says she was removed', async () => {
  await host.call(`/api/cloud/workspaces/${state.workspace}/members/${encodeURIComponent('sara@example.com')}`, undefined, 'DELETE')
  await statusUntil(host, (s) => !s.workspaces.find((w) => w.id === state.workspace)?.members.some((m) => m.email === 'sara@example.com'), 'sara off mo\'s list')
  const cut = await statusUntil(sara, (s) => !s.workspaces.some((w) => w.id === state.workspace), 'sara to lose the workspace')
  return `sara keeps ${cut.workspaces.length} workspace(s); gone: ${JSON.stringify(cut.gone)}`
})

check('Y8', 'A restart keeps the cloud on and live', 'the Mac runtime restarts with the same device and workspace; a message sent after the restart reaches the restored runtime', async () => {
  await host.restart()
  const back = await statusUntil(host, (s) => s.status === 'on', 'the host to come back on')
  assert.equal(back.device, state.device)
  assert.equal(back.workspace?.id, state.workspace)
  await until(async () => (await host.call(`/api/agents/${state.agent}`)).status === 'running', 'the agent to run again')
  await say(host, { agentId: state.agent, text: CANARIES.messages[2] })
  await until(async () => (await said(restored, state.agent)).includes(CANARIES.messages[2]), 'the new message on the restored runtime')
  return `same device and workspace after the restart; the new message reached the restored runtime`
})

check('Y9', 'The room holds the connection only locked', 'the DSN password is in no byte of the cloud’s storage', async () => {
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => statSync(join(dir, name)).isDirectory() ? files(join(dir, name)) : [join(dir, name)])
  const all = files(CLOUD_STATE)
  const hits = all.filter((file) => readFileSync(file).includes(SECRET))
  assert.deepEqual(hits, [])
  return `${all.length} files, 0 hits`
})
