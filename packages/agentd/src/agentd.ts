import { execFile, spawn } from 'node:child_process'
import { chmodSync, chownSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const RELEASE_URL = process.env.FASTMONKEY_URL ?? 'https://fastmonkey.dev'
const INSTALL_LOCK = '/run/fastmonkey-install.lock'
const UPDATE_SCRIPT = 'curl -fsSL "$FASTMONKEY_URL" | sh'
const SOCK = process.env.AGENTD_SOCK ?? '/run/agentd/agentd.sock'
const IMAGE = process.env.AGENT_IMAGE || readFileSync(new URL('../../../install/agent-image', import.meta.url), 'utf8').trim()
const APP_GID = Number(process.env.APP_GID ?? 0)
const FIREWALL = fileURLToPath(new URL('../../../install/agents-firewall.sh', import.meta.url))
const PLUGINS = fileURLToPath(new URL('../../../vendor/hermes-plugins', import.meta.url))
const CLAUDE_BIN = fileURLToPath(new URL('../../../bin/claude', import.meta.url))
const BRIDGE = '/var/lib/fastmonkey/whatsapp-bridge'
const AGENT_UID = 10000
const ID = /^ag_[a-z0-9]{8}$/
const FILES = ['config.yaml', '.env', 'SOUL.md'] as const
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
const EXEC = { maxBuffer: 16 << 20, timeout: 60_000 }
const FIREWALL_FRESH_MS = 5_000
const WATCHDOG_MS = 30_000
const PAIR_MS = 5 * 60_000
const MAX_REQUEST = 1 << 20

const pairings = new Map<string, Pairing>()
const queues = new Map<string, Promise<unknown>>()
let lastFirewallCheck = { at: 0, on: false }
let pendingFirewallCheck: Promise<boolean> | undefined

mkdirSync(dirname(SOCK), { recursive: true })
rmSync(SOCK, { force: true })
setInterval(() => watchFirewall().catch((e) => console.error(`watchdog: ${errorText(e)}`)), WATCHDOG_MS)
createServer({ allowHalfOpen: true }, serve).listen(SOCK, () => {
  chownSync(SOCK, 0, APP_GID)
  chmodSync(SOCK, 0o660)
  console.log(`agentd on ${SOCK}`)
})

function serve(sock: Socket) {
  let buf = ''
  const read = (chunk: string | Buffer) => {
    buf += chunk
    const end = buf.indexOf('\n')
    if (end < 0 && buf.length <= MAX_REQUEST) return
    sock.off('data', read)
    if (end < 0 || end > MAX_REQUEST) {
      sock.end(JSON.stringify({ ok: false, error: 'request too large' }))
      return
    }
    Promise.resolve(buf.slice(0, end))
      .then((line) => {
        const req = parseRequest(JSON.parse(line))
        return 'id' in req ? enqueue(req.id, () => handle(req)) : handle(req)
      })
      .then(
        (reply) => sock.end(JSON.stringify({ ok: true, ...reply })),
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
      return { firewall: await firewallRecent(), image: IMAGE, updating: await installing() }
    case 'ps':
      return { states: await containerStates() }
    case 'create':
      return create(req.id, req.net, req.files)
    case 'apply': {
      writeConf(req.id, req.files)
      const shouldRestart = req.restart && (req.force || (await stale(req.id)))
      if (shouldRestart) await restartContainer(req.id)
      return { applied: req.id, restarted: shouldRestart }
    }
    case 'start':
      await start(req.id)
      return { started: req.id }
    case 'stop':
      pairings.delete(req.id)
      await docker('stop', '-t', '10', `ag-${req.id}`)
      return { stopped: req.id }
    case 'rm':
      return remove(req.id)
    case 'wa-pair':
      return pair(req.id)
    case 'wa-unlink':
      return unlink(req.id)
    case 'update':
      return update()
  }
}

function parseRequest(value: unknown): AgentdRequest {
  if (!isRecord(value)) throw new Error('bad request')
  const { cmd } = value
  switch (cmd) {
    case 'health':
    case 'ps':
    case 'update':
      return { cmd }
    case 'create':
      return { cmd, id: agentId(value.id), net: netOf(value.net), files: filesOf(value.files) }
    case 'apply':
      return { cmd, id: agentId(value.id), files: filesOf(value.files), restart: value.restart === true, force: value.force === true }
    case 'start':
    case 'stop':
    case 'rm':
    case 'wa-pair':
    case 'wa-unlink':
      return { cmd, id: agentId(value.id) }
    default:
      throw new Error(`unknown command ${String(cmd)}`)
  }
}

function agentId(value: unknown) {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('bad agent id')
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

async function create(id: string, net: number, files: AgentFiles) {
  await mustHaveFirewall()
  makeHome(id)
  writeConf(id, files)
  await docker('network', 'create', '--subnet', `10.200.${net}.0/24`, '--gateway', `10.200.${net}.1`, '--label', `fastmonkey.agent=${id}`, `ag-${id}`)
  const digest = await docker('image', 'inspect', '--format', '{{index .RepoDigests 0}}', IMAGE).catch(() => IMAGE)
  await docker(
    'create',
    ...['--name', `ag-${id}`, '--hostname', id, '--restart', 'no'],
    ...['--label', `fastmonkey.agent=${id}`, '--label', `agent.digest=${digest}`],
    ...['--runtime', 'runsc', '--user', `${AGENT_UID}:${AGENT_UID}`, '--init', '--entrypoint', '/opt/hermes/bin/hermes'],
    ...['--read-only', '--tmpfs', '/tmp:rw,nosuid,size=256m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'],
    ...['--pids-limit', '512', '--memory', '1g', '--cpus', '1', '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3'],
    ...['--network', `ag-${id}`, '--ip', `10.200.${net}.2`],
    ...Object.entries(AGENT_ENV).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    ...['--mount', 'type=bind,src=/etc/agentd/resolv.conf,dst=/etc/resolv.conf,readonly'],
    ...['--mount', `type=bind,src=${home(id)},dst=/opt/data`],
    ...['--mount', `type=bind,src=${home(id)}/platforms,dst=/opt/data/platforms`],
    ...['--mount', `type=bind,src=${home(id)}/.claude,dst=/opt/data/.claude`],
    ...FILES.flatMap((name) => readOnly(id, name, name)),
    ...readOnly(id, 'skills', 'skills'),
    ...readOnly(id, CLAUDE_SETTINGS_FILE, '.claude/settings.json'),
    ...['--mount', `type=bind,src=${PLUGINS},dst=/opt/data/plugins,readonly`],
    ...['--mount', `type=bind,src=${CLAUDE_BIN},dst=/usr/local/bin/claude,readonly`],
    ...(existsSync(`${BRIDGE}/node_modules`) ? ['--mount', `type=bind,src=${BRIDGE},dst=/opt/data/scripts/whatsapp-bridge,readonly`] : []),
    ...['--tmpfs', '/opt/data/hooks:ro,size=4k', '--tmpfs', '/opt/data/pairing:ro,size=4k', '--tmpfs', '/opt/data/platforms/pairing:ro,size=4k'],
    ...[digest, 'gateway', 'run'],
  )
  return { container: `ag-${id}` }
}

async function start(id: string) {
  await mustHaveFirewall()
  if (await isRunning(id)) return
  for (const name of HERMES_RUNTIME_FILES) rmSync(`${home(id)}/${name}`, { force: true })
  await docker('start', `ag-${id}`)
}

async function restartContainer(id: string) {
  await mustHaveFirewall()
  await docker('stop', '-t', '10', `ag-${id}`)
  await start(id)
}

async function remove(id: string) {
  pairings.delete(id)
  await docker('rm', '-f', `ag-${id}`).catch(ignoreMissing)
  await docker('network', 'rm', `ag-${id}`).catch(ignoreMissing)
  rmSync(home(id), { recursive: true, force: true })
  rmSync(conf(id), { recursive: true, force: true })
  return { removed: id }
}

async function pair(id: string): Promise<Pairing> {
  const known = pairings.get(id)
  if (known && known.status !== 'error') return known
  if (!existsSync(`${BRIDGE}/node_modules`)) throw new Error("the WhatsApp bridge isn't installed on this server; run the installer again")
  if (!(await isRunning(id))) throw new Error("the agent isn't running")
  const p: Pairing = { status: 'starting' }
  pairings.set(id, p)
  const proc = spawn(
    'docker',
    [
      'exec',
      `ag-${id}`,
      'node',
      '/opt/data/scripts/whatsapp-bridge/bridge.js',
      '--pair-only',
      '--pair-json',
      '--session',
      '/opt/data/platforms/whatsapp/session',
    ],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const timer = setTimeout(() => {
    if (pending(p)) failPairing(p, 'nobody scanned the code within 5 minutes')
    proc.kill()
  }, PAIR_MS)
  proc.on('error', (e) => failPairing(p, `pairing didn't start: ${e.message}`))
  createInterface({ input: proc.stdout }).on('line', (line) => followBridge(p, line))
  proc.on('exit', (code) => {
    clearTimeout(timer)
    if (pending(p)) failPairing(p, `pairing exited (${code})`)
    if (pairings.get(id) === p) enqueue(id, () => restartContainer(id)).catch((e) => console.error(`wa-pair: restart ${id}: ${errorText(e)}`))
  })
  return p
}

function followBridge(p: Pairing, line: string) {
  const event = jsonOrUndefined(line)
  if (!isRecord(event)) return
  switch (event.event) {
    case 'qr':
      if (typeof event.qr !== 'string') return
      p.status = 'qr'
      p.qr = event.qr
      return
    case 'connected':
      p.status = 'linked'
      p.qr = undefined
      p.phone = phoneOf(event.user)
      return
    case 'error':
      failPairing(p, String(event.error).slice(0, 200))
  }
}

async function unlink(id: string) {
  const active = pending(pairings.get(id))
  pairings.delete(id)
  rmSync(`${home(id)}/platforms/whatsapp/session`, { recursive: true, force: true })
  if (active) await restartContainer(id)
  return { unlinked: id }
}

async function watchFirewall() {
  if (await firewallOn()) return
  await run(FIREWALL, [], EXEC).catch((e) => console.error(`watchdog: firewall re-apply failed: ${errorText(e)}`))
  if (await firewallOn()) {
    console.log(`watchdog: re-applied the firewall at ${new Date().toISOString()}`)
    return
  }
  const ids = (await docker('ps', '-q', '--filter', 'label=fastmonkey.agent').catch(() => '')).split('\n').filter(Boolean)
  if (ids.length) await docker('stop', '-t', '5', ...ids).catch((e) => console.error(`watchdog: stop failed: ${errorText(e)}`))
  console.error(`watchdog: firewall missing; stopped ${ids.length} agents at ${new Date().toISOString()}`)
}

function firewallOn() {
  pendingFirewallCheck ??= run(FIREWALL, ['--check'], EXEC)
    .then(
      () => true,
      () => false,
    )
    .then((on) => {
      lastFirewallCheck = { at: Date.now(), on }
      return on
    })
    .finally(() => {
      pendingFirewallCheck = undefined
    })
  return pendingFirewallCheck
}

async function firewallRecent() {
  if (Date.now() - lastFirewallCheck.at < FIREWALL_FRESH_MS) return lastFirewallCheck.on
  return firewallOn()
}

async function mustHaveFirewall() {
  if (!(await firewallOn())) throw new Error('firewall is off; refusing to run agents')
}

async function containerStates() {
  const out = await docker('ps', '-a', '--filter', 'label=fastmonkey.agent', '--format', '{{.Label "fastmonkey.agent"}} {{.State}}')
  return Object.fromEntries(
    out
      .split('\n')
      .filter(Boolean)
      .map((line): [string, string] => {
        const [id, state] = line.split(' ')
        return [id, state]
      }),
  )
}

async function isRunning(id: string) {
  return (await docker('inspect', '-f', '{{.State.Running}}', `ag-${id}`).catch(ignoreMissing)) === 'true'
}

async function stale(id: string) {
  const started = Date.parse((await docker('inspect', '-f', '{{.State.StartedAt}}', `ag-${id}`)).replace(/(\.\d{3})\d+/, '$1'))
  return Math.max(...[...FILES, CLAUDE_SETTINGS_FILE].map((name) => statSync(`${conf(id)}/${name}`).mtimeMs)) > started
}

function writeConf(id: string, files: AgentFiles) {
  const dir = conf(id)
  mkdirSync(`${dir}/skills`, { recursive: true })
  for (const d of [dir, `${dir}/skills`]) {
    chownSync(d, 0, AGENT_UID)
    chmodSync(d, 0o750)
  }
  for (const name of FILES) writeIfChanged(`${dir}/${name}`, files[name])
  writeIfChanged(`${dir}/${CLAUDE_SETTINGS_FILE}`, CLAUDE_SETTINGS)
}

function writeIfChanged(path: string, body: string) {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== body) writeFileSync(path, body)
  chownSync(path, 0, AGENT_UID)
  chmodSync(path, 0o640)
}

function makeHome(id: string) {
  for (const sub of ['', '/.claude', '/home', '/platforms', '/scripts', '/scripts/whatsapp-bridge']) {
    const d = `${home(id)}${sub}`
    mkdirSync(d, { recursive: true })
    chownSync(d, AGENT_UID, AGENT_UID)
    chmodSync(d, 0o700)
  }
}

async function docker(...args: string[]) {
  return (await run('docker', args, EXEC)).stdout.trim()
}

function readOnly(id: string, src: string, dst: string) {
  return ['--mount', `type=bind,src=${conf(id)}/${src},dst=/opt/data/${dst},readonly`]
}

function conf(id: string) {
  return `/data/agent-conf/${id}`
}

function home(id: string) {
  return `/data/agents/${id}`
}

function pending(p: Pairing | undefined) {
  return p?.status === 'starting' || p?.status === 'qr'
}

function failPairing(p: Pairing, error: string) {
  p.status = 'error'
  p.error = error
}

function phoneOf(user: unknown) {
  const id = isRecord(user) ? String(user.id ?? '') : ''
  return id.split(/[:@]/)[0] || undefined
}

function jsonOrUndefined(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

function ignoreMissing(e: unknown) {
  if (!/No such (container|network)|not found/i.test(errorText(e))) throw e
  return ''
}

async function installing(): Promise<boolean> {
  return run('flock', ['-n', INSTALL_LOCK, 'true']).then(() => false, (e: unknown) => isRecord(e) && e.code === 1)
}

async function update(): Promise<AgentdReplies['update']> {
  if (await installing()) throw new Error('an install or update is already running')
  if (existsSync('/run/systemd/system')) {
    await run('systemd-run', ['--unit=fastmonkey-update', '--collect', '--quiet', `--setenv=FASTMONKEY_URL=${RELEASE_URL}`, '/bin/sh', '-c', UPDATE_SCRIPT])
  } else {
    spawn('/bin/sh', ['-c', `(${UPDATE_SCRIPT}) >> /var/log/fastmonkey-boot.log 2>&1`], { detached: true, stdio: 'ignore', env: { ...process.env, FASTMONKEY_URL: RELEASE_URL } }).unref()
  }
  return { updating: true }
}

function errorText(e: unknown) {
  const stderr = isRecord(e) ? e.stderr : undefined
  if (typeof stderr === 'string' && stderr.trim()) return stderr.trim()
  return e instanceof Error ? e.message : String(e)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export type AgentdRequest =
  | { cmd: 'health' }
  | { cmd: 'ps' }
  | { cmd: 'update' }
  | { cmd: 'create'; id: string; net: number; files: AgentFiles }
  | { cmd: 'apply'; id: string; files: AgentFiles; restart: boolean; force?: boolean }
  | { cmd: 'start' | 'stop' | 'rm' | 'wa-pair' | 'wa-unlink'; id: string }

export type AgentdReplies = {
  health: { firewall: boolean; image: string; updating: boolean }
  ps: { states: Record<string, string> }
  create: { container: string }
  apply: { applied: string; restarted: boolean }
  start: { started: string }
  stop: { stopped: string }
  rm: { removed: string }
  'wa-pair': Pairing
  'wa-unlink': { unlinked: string }
  update: { updating: boolean }
}

export type Pairing = { status: 'starting' | 'qr' | 'linked' | 'error'; qr?: string; phone?: string; error?: string }

type AgentFiles = Record<string, string>
type Reply = AgentdReplies[keyof AgentdReplies]
