import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, chownSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { newMessages, usage, type NewMessage } from './messages.ts'
import { isMemoryTarget, MAX_MEMORY_BYTES, readMemory, writeMemory, type MemoryTarget } from './memory.ts'
import { isSkillPath, listSkills, MAX_SKILL_BYTES, readSkill, writeSkill, type SkillHead } from './skills.ts'
import { FREE_POLICY, HELD_POLICY, live, POLICY_FILE, policyOf } from './browser.ts'
import { fenceLines, proveFence, type FenceReport } from './fence.ts'
import { MAX_HOME_BASE64, packHome, unpackHome } from './home.ts'
import { isHomePath, isUploadName, MAX_FILE_BASE64, readHomeFile, removeUploads, saveUpload, statHomeFiles } from './files.ts'
import { FIREWALL, imageReady } from './sandbox/gvisor.ts'
import { sandboxes } from './sandbox/index.ts'
import type { Mount, SandboxSpec, SandboxState } from './sandbox/sandbox.ts'
import { installing, lastUpdate, update, type LastUpdate } from './update.ts'
import { errorText, EXEC, isRecord } from './util.ts'
import { followPairing, PAIR_COMMAND, pending, type Pairing } from './whatsapp.ts'

const run = promisify(execFile)
const SOCK = process.env.AGENTD_SOCK ?? '/run/agentd/agentd.sock'
const IMAGE = process.env.AGENT_IMAGE || readFileSync(new URL('../../../../install/agent-image', import.meta.url), 'utf8').trim()
const APP_GID = Number(process.env.APP_GID ?? 0)
const ASSETS = process.env.AGENTD_ASSETS || dirname(fileURLToPath(new URL('../../../../package.json', import.meta.url)))
const PLUGINS = `${ASSETS}/vendor/hermes-plugins`
const CLAUDE_BIN = `${ASSETS}/bin/claude`
const MOUNTS = createHash('sha256').update(`${PLUGINS}\n${CLAUDE_BIN}`).digest('hex').slice(0, 16)
const BROWSER_BIN = fileURLToPath(new URL('../../../../bin/agent-browser', import.meta.url))
const BROWSER_DIR = fileURLToPath(new URL('../../../../install/agent-browser', import.meta.url))
const BRIDGE = '/opt/agent-browser/bridge.mjs'
const BROWSER_MEMORY_MIB = 4096
const MAX_FPS = 30
const BROWSER_TMP_MIB = 1024
const TMP_MIB = 256
const DATA = resolve(process.env.AGENTD_DATA || '/data')
const RESOLV = process.env.AGENTD_RESOLV || '/etc/agentd/resolv.conf'
const WHATSAPP_BRIDGE = process.env.AGENTD_WHATSAPP_BRIDGE || '/var/lib/openhut/whatsapp-bridge'
const AGENT_UID = 10000
const AGENT_USER = `${AGENT_UID}:${AGENT_UID}`
const AS_ROOT = process.getuid?.() === 0
const PIPE = process.platform === 'win32'
const SPEC = '4'
const AGENT_MEMORY_MIB = 1024
const AGENT_CPUS = 1
const ID = /^ag_[a-z0-9]{8}$/
const FILES = ['config.yaml', '.env', 'SOUL.md', 'auth.json'] as const
const MAX_FILE = 200_000
const CLAUDE_SETTINGS_FILE = 'claude-settings.json'
const CLAUDE_SETTINGS = JSON.stringify({ disableAllHooks: true, cleanupPeriodDays: 1 }) + '\n'
const HERMES_RUNTIME_FILES = ['gateway.pid', 'gateway.lock', 'gateway_state.json']
const AGENT_ENV = {
  HERMES_HOME: '/opt/data',
  TERMINAL_HOME_MODE: 'profile',
  PYTHONNOUSERSITE: '1',
  CLAUDE_CONFIG_DIR: '/opt/data/.claude',
  USER: 'hermes',
  HOME: '/opt/data/home',
  DISABLE_AUTOUPDATER: '1',
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  HERMES_GATEWAY_LOCK_DIR: '/tmp/hermes-locks',
}
const LOCKED_TMPFS = ['/opt/data/hooks', '/opt/data/pairing', '/opt/data/platforms/pairing']
const FIREWALL_FRESH_MS = 5_000
const WATCHDOG_MS = 30_000
const MAX_REQUEST = 1 << 20
const MAX_LISTED = 200

const pairings = new Map<string, Pairing>()
const queues = new Map<string, Promise<unknown>>()
let lastFirewallCheck = { at: 0, on: false }
let pendingFirewallCheck: Promise<Readiness> | undefined
const box = await sandboxes()

if (!PIPE) mkdirSync(dirname(SOCK), { recursive: true })
for (const dir of [`${DATA}/agents`, `${DATA}/agent-conf`]) mkdirSync(dir, { recursive: true, mode: 0o700 })
for (const id of readdirSync(`${DATA}/agent-conf`).filter((name) => ID.test(name))) writeIfChanged(`${conf(id)}/${POLICY_FILE}`, FREE_POLICY)
if (!PIPE) rmSync(SOCK, { force: true })
if (box.name === 'gvisor') setInterval(() => watchFirewall().catch((e) => console.error(`watchdog: ${errorText(e)}`)), WATCHDOG_MS)
export const server = createServer({ allowHalfOpen: true }, serve).listen(SOCK, () => {
  own({ path: SOCK, uid: 0, gid: APP_GID, mode: 0o660 })
  console.log(`agentd on ${SOCK}`)
})
let fence = checkFence()

function serve(sock: Socket) {
  let buf = ''
  const read = (chunk: string | Buffer) => {
    buf += chunk
    const end = buf.indexOf('\n')
    if (end < 0 && buf.length <= MAX_REQUEST) return
    sock.off('data', read)
    sock.pause()
    if (end < 0 || end > MAX_REQUEST) {
      sock.end(JSON.stringify({ ok: false, error: 'request too large' }))
      return
    }
    Promise.resolve(buf.slice(0, end))
      .then((line) => {
        const req = parseRequest(JSON.parse(line))
        if (req.cmd === 'browser-live') return openLive({ sock, id: req.id, fps: req.fps, rest: buf.slice(end + 1) })
        if (req.cmd === 'home-import') return restOf({ sock, rest: buf.slice(end + 1), limit: MAX_HOME_BASE64 }).then((tar) => enqueue(req.id, () => importHome({ id: req.id, tar })))
        if (req.cmd === 'file-write') return restOf({ sock, rest: buf.slice(end + 1), limit: MAX_FILE_BASE64 }).then((body) => enqueue(req.id, async () => ({ path: saveUpload({ home: agentHome(req.id), name: req.name, body: Buffer.from(body, 'base64'), owner: AS_ROOT ? { uid: AGENT_UID, gid: AGENT_UID } : undefined }) })))
        return 'id' in req ? enqueue(req.id, () => handle(req)) : handle(req)
      })
      .then(
        (reply) => reply && sock.end(JSON.stringify({ ok: true, ...reply })),
        (e) => sock.end(JSON.stringify({ ok: false, error: errorText(e).slice(0, 2000) })),
      )
  }
  sock.setEncoding('utf8')
  sock.on('data', read)
  sock.on('error', () => {})
}

function enqueue<T>(id: string, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work)
  queues.set(id, next)
  next
    .finally(() => {
      if (queues.get(id) === next) queues.delete(id)
    })
    .catch(() => {})
  return next
}

async function handle(req: AgentdRequest): Promise<Reply> {
  switch (req.cmd) {
    case 'health':
      return { firewall: await firewallRecent(), image: IMAGE, imageReady: box.name === 'gvisor' ? await imageReady(IMAGE) : true, updating: await installing(), lastUpdate: lastUpdate(), features: features() }
    case 'ps':
      return { states: await containerStates() }
    case 'create':
      return create(req)
    case 'apply': {
      writeConf(req.id, req.files)
      if (await outdated(req.id, req.browser)) {
        pairings.delete(req.id)
        await create(req)
        if (req.restart) await start(req.id)
        return { applied: req.id, restarted: req.restart }
      }
      const shouldRestart = req.restart && (req.force || (await stale(req.id)))
      if (shouldRestart) await restartContainer(req.id)
      return { applied: req.id, restarted: shouldRestart }
    }
    case 'start':
      await start(req.id)
      return { started: req.id }
    case 'stop':
      pairings.delete(req.id)
      await box.stop({ id: req.id, seconds: 10 })
      return { stopped: req.id }
    case 'rm':
      return remove(req.id)
    case 'wa-pair':
      return pair(req.id)
    case 'wa-unlink':
      return unlink(req.id)
    case 'update':
      return box.name === 'memory' ? { updating: true } : update({ appVersion: req.appVersion, sha256: req.sha256 })
    case 'skills':
      return listSkills(inHome(req.id, 'skills'))
    case 'skill-read':
      return { body: readSkill({ root: inHome(req.id, 'skills'), path: req.path }) }
    case 'skill-write':
      writeSkill({ root: inHome(req.id, 'skills'), path: req.path, body: req.body })
      return { written: req.path }
    case 'skill-rm':
      await removeSkill(req.id, req.path)
      return { removed: req.path }
    case 'memory':
      return readMemory(inHome(req.id, 'memories'))
    case 'home-export':
      if (await isRunning(req.id)) throw new Error('stop the agent before packing its home')
      return { tar: await packHome(home(req.id)) }
    case 'home-import':
      throw new Error('send the home after the request line')
    case 'file-write':
      throw new Error('send the file after the request line')
    case 'file-rm':
      return { removed: removeUploads({ home: agentHome(req.id), names: req.names }) }
    case 'file-stat':
      return { files: statHomeFiles({ home: agentHome(req.id), paths: req.paths }) }
    case 'file-read':
      return { body: readHomeFile({ home: agentHome(req.id), path: req.path })?.toString('base64') ?? null }
    case 'memory-write':
      writeMemory({ root: inHome(req.id, 'memories'), target: req.target, body: req.body })
      return { written: req.target }
    case 'usage':
      return { usage: usage({ agents: stateDbs(), since: req.since }) }
    case 'messages':
      return { messages: newMessages({ agents: stateDbs(), since: req.since }) }
    case 'fence':
      if (!(await fence).ok) fence = checkFence()
      return fence
  }
}

function parseRequest(value: unknown): AgentdRequest {
  if (!isRecord(value)) throw new Error('bad request')
  const { cmd } = value
  switch (cmd) {
    case 'health':
    case 'ps':
    case 'fence':
      return { cmd }
    case 'update':
      if (value.appVersion !== undefined && (typeof value.appVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(value.appVersion))) throw new Error('bad app version')
      if (typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) throw new Error('bad sha256')
      return { cmd, appVersion: value.appVersion, sha256: value.sha256 }
    case 'usage':
    case 'messages':
      if (typeof value.since !== 'number' || !Number.isFinite(value.since)) throw new Error('bad since')
      return { cmd, since: value.since }
    case 'create':
      return { cmd, id: agentId(value.id), net: netOf(value.net), files: filesOf(value.files), browser: value.browser === true }
    case 'apply':
      return { cmd, id: agentId(value.id), net: netOf(value.net), files: filesOf(value.files), browser: value.browser === true, restart: value.restart === true, force: value.force === true }
    case 'browser-live':
      return { cmd, id: agentId(value.id), fps: Number.isInteger(value.fps) && Number(value.fps) >= 1 ? Math.min(Number(value.fps), MAX_FPS) : MAX_FPS }
    case 'start':
    case 'stop':
    case 'rm':
    case 'wa-pair':
    case 'wa-unlink':
    case 'skills':
    case 'memory':
    case 'home-export':
    case 'home-import':
      return { cmd, id: agentId(value.id) }
    case 'skill-read':
    case 'skill-rm':
      return { cmd, id: agentId(value.id), path: skillPath(value.path) }
    case 'file-write':
      if (!isUploadName(value.name)) throw new Error('bad file name')
      return { cmd, id: agentId(value.id), name: value.name }
    case 'file-rm':
      if (!Array.isArray(value.names) || value.names.length > MAX_LISTED || !value.names.every(isUploadName)) throw new Error('bad file names')
      return { cmd, id: agentId(value.id), names: value.names }
    case 'file-stat':
      if (!Array.isArray(value.paths) || value.paths.length > MAX_LISTED || !value.paths.every(isHomePath)) throw new Error('bad file paths')
      return { cmd, id: agentId(value.id), paths: value.paths }
    case 'file-read':
      if (!isHomePath(value.path)) throw new Error('bad file path')
      return { cmd, id: agentId(value.id), path: value.path }
    case 'memory-write':
      if (!isMemoryTarget(value.target)) throw new Error('bad memory target')
      if (typeof value.body !== 'string' || Buffer.byteLength(value.body) > MAX_MEMORY_BYTES) throw new Error('missing or oversized memory')
      return { cmd, id: agentId(value.id), target: value.target, body: value.body }
    case 'skill-write':
      if (typeof value.body !== 'string' || !value.body || Buffer.byteLength(value.body) > MAX_SKILL_BYTES) throw new Error('missing or oversized skill body')
      return { cmd, id: agentId(value.id), path: skillPath(value.path), body: value.body }
    default:
      throw new Error(`unknown command ${String(cmd)}`)
  }
}

function agentId(value: unknown) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('bad agent id')
  return value
}

function skillPath(value: unknown) {
  if (!isSkillPath(value)) throw new Error('bad skill path')
  return value
}

function netOf(value: unknown) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 250) throw new Error('bad net')
  return value
}

function filesOf(value: unknown): AgentFiles {
  if (!isRecord(value)) throw new Error('missing files')
  const files: AgentFiles = {}
  for (const name of FILES) {
    const body = value[name]
    if (typeof body !== 'string' || body.length > MAX_FILE) throw new Error(`missing or oversized ${name}`)
    files[name] = body
  }
  return files
}

async function create({ id, net, files, browser }: { id: string; net: number; files: AgentFiles; browser: boolean }) {
  await mustHaveFirewall()
  if (browser && box.name !== 'memory' && !existsSync(BROWSER_BIN)) throw new Error("agent-browser isn't installed on this server; run the installer again")
  makeHome(id)
  writeConf(id, files)
  await box.create(specOf({ id, net, browser }))
  return { container: `ag-${id}` }
}

async function start(id: string) {
  await mustHaveFirewall()
  if (await isRunning(id)) return
  for (const name of HERMES_RUNTIME_FILES) rmSync(`${home(id)}/${name}`, { force: true })
  await box.start(id)
}

async function restartContainer(id: string) {
  await mustHaveFirewall()
  await box.stop({ id, seconds: 10 })
  await start(id)
}

async function remove(id: string) {
  pairings.delete(id)
  await box.remove(id)
  rmSync(home(id), { recursive: true, force: true })
  rmSync(conf(id), { recursive: true, force: true })
  return { removed: id }
}

async function pair(id: string): Promise<Pairing> {
  const known = pairings.get(id)
  if (known && known.status !== 'error') return known
  if (!existsSync(`${WHATSAPP_BRIDGE}/node_modules`)) throw new Error("the WhatsApp bridge isn't installed on this server; run the installer again")
  if (!(await isRunning(id))) throw new Error("the agent isn't running")
  const p = followPairing({
    proc: await box.exec({ id, command: PAIR_COMMAND }),
    onExit: () => {
      if (pairings.get(id) === p) enqueue(id, () => restartContainer(id)).catch((e) => console.error(`wa-pair: restart ${id}: ${errorText(e)}`))
    },
  })
  pairings.set(id, p)
  return p
}

async function unlink(id: string) {
  const active = pending(pairings.get(id))
  pairings.delete(id)
  rmSync(`${home(id)}/platforms/whatsapp/session`, { recursive: true, force: true })
  if (active) await restartContainer(id)
  return { unlinked: id }
}

async function watchFirewall() {
  if ((await checkReady()).ok) return
  await run(FIREWALL, [], EXEC).catch((e) => console.error(`watchdog: firewall re-apply failed: ${errorText(e)}`))
  if ((await checkReady()).ok) {
    console.log(`watchdog: re-applied the firewall at ${new Date().toISOString()}`)
    return
  }
  const running = (await agents().catch(() => [])).filter((each) => each.running)
  await Promise.all(running.map((each) => box.stop({ id: each.id, seconds: 5 }).catch((e) => console.error(`watchdog: stop failed: ${errorText(e)}`))))
  console.error(`watchdog: firewall missing; stopped ${running.length} agents at ${new Date().toISOString()}`)
}

function checkReady() {
  pendingFirewallCheck ??= box.ready()
    .catch((e: unknown) => ({ ok: false, reason: errorText(e) }))
    .then((ready) => {
      lastFirewallCheck = { at: Date.now(), on: ready.ok }
      return ready
    })
    .finally(() => {
      pendingFirewallCheck = undefined
    })
  return pendingFirewallCheck
}

async function firewallRecent() {
  if (Date.now() - lastFirewallCheck.at < FIREWALL_FRESH_MS) return lastFirewallCheck.on
  return (await checkReady()).ok
}

async function mustHaveFirewall() {
  const ready = await checkReady()
  if (!ready.ok) throw new Error(`${ready.reason ?? 'the sandbox is not ready'}; refusing to run agents`)
}

async function containerStates() {
  return Object.fromEntries((await agents()).map((each) => [each.id, stateText(each)]))
}

async function agents() {
  return (await box.list()).filter((each) => ID.test(each.id))
}

function stateText({ running, startedAt }: SandboxState) {
  if (running) return 'running'
  return startedAt ? 'exited' : 'created'
}

async function sandboxOf(id: string) {
  return (await agents()).find((each) => each.id === id)
}

async function isRunning(id: string) {
  return (await sandboxOf(id))?.running === true
}

async function outdated(id: string, browser: boolean) {
  const made = (await sandboxOf(id))?.labels
  return !!made && `${made['openhut.spec'] ?? ''} ${made['openhut.browser'] || 'off'} ${made['openhut.mounts'] ?? ''}` !== `${SPEC} ${browser ? 'on' : 'off'} ${MOUNTS}`
}

function specOf({ id, net, browser }: { id: string; net: number; browser: boolean }): SandboxSpec {
  return {
    id, image: IMAGE, cpus: AGENT_CPUS, memoryMib: browser ? BROWSER_MEMORY_MIB : AGENT_MEMORY_MIB,
    user: AGENT_USER, entrypoint: '/opt/hermes/bin/hermes', command: ['gateway', 'run'], env: AGENT_ENV,
    mounts: [
      { host: RESOLV, guest: '/etc/resolv.conf', readOnly: true },
      { host: home(id), guest: '/opt/data', readOnly: false },
      { host: `${home(id)}/platforms`, guest: '/opt/data/platforms', readOnly: false },
      { host: `${home(id)}/.claude`, guest: '/opt/data/.claude', readOnly: false },
      ...FILES.map((name) => readOnly(id, name, name)),
      readOnly(id, CLAUDE_SETTINGS_FILE, '.claude/settings.json'),
      { host: PLUGINS, guest: '/opt/data/plugins', readOnly: true },
      { host: CLAUDE_BIN, guest: '/usr/local/bin/claude', readOnly: true },
      ...(existsSync(`${WHATSAPP_BRIDGE}/node_modules`) ? [{ host: WHATSAPP_BRIDGE, guest: '/opt/data/scripts/whatsapp-bridge', readOnly: true }] : []),
      ...(browser ? browserMounts(id) : []),
    ],
    tmpfs: [{ guest: '/tmp', sizeMib: browser ? BROWSER_TMP_MIB : TMP_MIB }, ...LOCKED_TMPFS.map((guest) => ({ guest, sizeMib: 4 / 1024, readOnly: true }))],
    labels: { 'openhut.spec': SPEC, 'openhut.browser': browser ? 'on' : 'off', 'openhut.mounts': MOUNTS },
    net,
  }
}

function browserMounts(id: string): Mount[] {
  return [
    { host: BROWSER_BIN, guest: '/usr/local/lib/agent-browser', readOnly: true },
    { host: BROWSER_DIR, guest: '/opt/agent-browser', readOnly: true },
    { host: `${BROWSER_DIR}/agent-browser.sh`, guest: '/usr/local/bin/agent-browser', readOnly: true },
    readOnly(id, POLICY_FILE, POLICY_FILE),
  ]
}

async function openLive({ sock, id, fps, rest }: { sock: Socket; id: string; fps: number; rest: string }): Promise<undefined> {
  if (!(await isRunning(id))) {
    sock.end(`${JSON.stringify({ type: 'closed' })}\n`)
    return undefined
  }
  const bridge = await box.exec({ id, command: ['node', BRIDGE, 'live', String(fps)], stdin: true })
  const setHeld = (held: boolean) => {
    if (existsSync(conf(id))) writeIfChanged(`${conf(id)}/${POLICY_FILE}`, held ? HELD_POLICY : FREE_POLICY)
  }
  live({ id, sock, bridge, rest, setHeld })
  return undefined
}

function features() {
  return { whatsapp: existsSync(`${WHATSAPP_BRIDGE}/node_modules`), browser: box.name === 'memory' || existsSync(BROWSER_BIN) }
}

function restOf({ sock, rest, limit }: { sock: Socket; rest: string; limit: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = rest
    const done = () => resolve(body.split('\n')[0])
    if (rest.includes('\n')) return done()
    sock.on('data', (chunk: string) => {
      body += chunk
      if (body.includes('\n')) {
        sock.off('end', done)
        return done()
      }
      if (body.length > limit) {
        sock.off('end', done)
        sock.pause()
        reject(new Error('the request is too large'))
      }
    })
    sock.on('end', done)
    sock.resume()
  })
}

async function importHome({ id, tar }: { id: string; tar: string }) {
  if (await sandboxOf(id)) throw new Error(`ag-${id} already exists here`)
  rmSync(home(id), { recursive: true, force: true })
  makeHome(id)
  await unpackHome({ dir: home(id), tar, owner: AS_ROOT ? { uid: AGENT_UID, gid: AGENT_UID } : undefined })
  return { imported: id }
}

async function stale(id: string) {
  const made = await sandboxOf(id)
  if (!made) throw new Error(`No such container: ag-${id}`)
  const started = made.startedAt ? Date.parse(made.startedAt.replace(/(\.\d{3})\d+/, '$1')) : 0
  return Math.max(...[...FILES, CLAUDE_SETTINGS_FILE].map((name) => statSync(`${conf(id)}/${name}`).mtimeMs)) > started
}

function writeConf(id: string, files: AgentFiles) {
  const dir = conf(id)
  mkdirSync(dir, { recursive: true })
  own({ path: dir, uid: 0, gid: AGENT_UID, mode: 0o750 })
  for (const name of FILES) writeIfChanged(`${dir}/${name}`, files[name])
  writeIfChanged(`${dir}/${CLAUDE_SETTINGS_FILE}`, CLAUDE_SETTINGS)
  writeIfChanged(`${dir}/${POLICY_FILE}`, policyOf(id))
}

function writeIfChanged(path: string, body: string) {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== body) writeFileSync(path, body)
  own({ path, uid: 0, gid: AGENT_UID, mode: 0o640 })
}

function own({ path, uid, gid, mode }: { path: string; uid: number; gid: number; mode: number }) {
  if (!AS_ROOT) return
  chownSync(path, uid, gid)
  chmodSync(path, mode)
}

function makeHome(id: string) {
  for (const sub of ['', '/.claude', '/home', '/platforms', '/scripts', '/scripts/whatsapp-bridge', '/skills']) {
    const d = `${home(id)}${sub}`
    mkdirSync(d, { recursive: true })
    own({ path: d, uid: AGENT_UID, gid: AGENT_UID, mode: 0o700 })
  }
}

function readOnly(id: string, src: string, dst: string): Mount {
  return { host: `${conf(id)}/${src}`, guest: `/opt/data/${dst}`, readOnly: true }
}

function conf(id: string) {
  return `${DATA}/agent-conf/${id}`
}

function home(id: string) {
  return `${DATA}/agents/${id}`
}

function stateDbs() {
  return readdirSync(`${DATA}/agents`).filter((name) => ID.test(name)).map((id) => ({ id, file: `${home(id)}/state.db` }))
}

async function removeSkill(id: string, path: string) {
  const spec: SandboxSpec = {
    id, image: IMAGE, cpus: 1, memoryMib: TMP_MIB, user: AGENT_USER, entrypoint: 'rm', command: [], env: {},
    mounts: [{ host: home(id), guest: '/opt/data', readOnly: false }], tmpfs: [], labels: {},
  }
  const { code } = await box.run({ spec, command: ['-rf', '--', `/opt/data/skills/${path}`] })
  if (code !== 0) throw new Error(`couldn't delete the skill (rm exited with ${code})`)
}

function agentHome(id: string) {
  return `${realpathSync(`${DATA}/agents`)}/${id}/home`
}

function inHome(id: string, dir: 'skills' | 'memories') {
  return `${realpathSync(`${DATA}/agents`)}/${id}/${dir}`
}

async function checkFence() {
  const spec = { id: 'fence', image: IMAGE, cpus: 1, memoryMib: TMP_MIB, user: AGENT_USER, env: {}, mounts: [{ host: RESOLV, guest: '/etc/resolv.conf', readOnly: true }], tmpfs: [{ guest: '/tmp', sizeMib: 16 }], labels: {} }
  const report = await proveFence({ box, spec })
  for (const line of fenceLines(report)) (report.ok ? console.log : console.error)(line)
  return report
}

type Features = { whatsapp: boolean; browser: boolean }
type Readiness = { ok: boolean; reason?: string }

export type AgentdRequest =
  | { cmd: 'health' | 'ps' | 'fence' }
  | { cmd: 'update'; appVersion?: string; sha256: string }
  | { cmd: 'create'; id: string; net: number; files: AgentFiles; browser: boolean }
  | { cmd: 'apply'; id: string; net: number; files: AgentFiles; browser: boolean; restart: boolean; force?: boolean }
  | { cmd: 'browser-live'; id: string; fps: number }
  | { cmd: 'start' | 'stop' | 'rm' | 'wa-pair' | 'wa-unlink' | 'skills' | 'memory' | 'home-export' | 'home-import'; id: string }
  | { cmd: 'skill-read' | 'skill-rm'; id: string; path: string }
  | { cmd: 'skill-write'; id: string; path: string; body: string }
  | { cmd: 'memory-write'; id: string; target: MemoryTarget; body: string }
  | { cmd: 'file-write'; id: string; name: string }
  | { cmd: 'file-read'; id: string; path: string }
  | { cmd: 'file-rm'; id: string; names: string[] }
  | { cmd: 'file-stat'; id: string; paths: string[] }
  | { cmd: 'usage' | 'messages'; since: number }

export type AgentdReplies = {
  health: { firewall: boolean; image: string; imageReady: boolean; updating: boolean; lastUpdate: LastUpdate | null; features: Features }
  ps: { states: Record<string, string> }
  create: { container: string }
  apply: { applied: string; restarted: boolean }
  start: { started: string }
  stop: { stopped: string }
  rm: { removed: string }
  'wa-pair': Pairing
  'wa-unlink': { unlinked: string }
  update: { updating: boolean }
  skills: { skills: SkillHead[]; bundled: string }
  'skill-read': { body: string }
  'skill-write': { written: string }
  'skill-rm': { removed: string }
  memory: Record<MemoryTarget, string | null>
  'memory-write': { written: MemoryTarget }
  'home-export': { tar: string }
  'home-import': { imported: string }
  'file-write': { path: string }
  'file-read': { body: string | null }
  'file-rm': { removed: string[] }
  'file-stat': { files: { path: string; size: number }[] }
  usage: { usage: Record<string, number> }
  messages: { messages: NewMessage[] }
  'browser-live': undefined
  fence: FenceReport
}

type AgentFiles = Record<string, string>
type Reply = AgentdReplies[keyof AgentdReplies]
