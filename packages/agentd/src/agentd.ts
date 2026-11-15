import { execFile, spawn } from 'node:child_process'
import { chmodSync, chownSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { DatabaseSync } from 'node:sqlite'
import { isMemoryTarget, MAX_MEMORY_BYTES, readMemory, writeMemory, type MemoryTarget } from './memory.ts'
import { isSkillPath, listSkills, MAX_SKILL_BYTES, readSkill, writeSkill, type SkillHead } from './skills.ts'

const run = promisify(execFile)
const RELEASE_URL = process.env.OPENHUT_URL ?? 'https://openhut.dev'
const INSTALL_LOCK = '/run/openhut-install.lock'
const UPDATE_SCRIPT = 'curl -fsSL "$OPENHUT_URL" | sh'
const SOCK = process.env.AGENTD_SOCK ?? '/run/agentd/agentd.sock'
const IMAGE = process.env.AGENT_IMAGE || readFileSync(new URL('../../../install/agent-image', import.meta.url), 'utf8').trim()
const APP_GID = Number(process.env.APP_GID ?? 0)
const FIREWALL = fileURLToPath(new URL('../../../install/agents-firewall.sh', import.meta.url))
const PLUGINS = fileURLToPath(new URL('../../../vendor/hermes-plugins', import.meta.url))
const CLAUDE_BIN = fileURLToPath(new URL('../../../bin/claude', import.meta.url))
const BRIDGE = '/var/lib/openhut/whatsapp-bridge'
const AGENT_UID = 10000
const SPEC = '2'
const SIZES = { standard: { memory: '1g', cpus: '1' }, large: { memory: '2g', cpus: '2' }, xlarge: { memory: '4g', cpus: '2' } } as const
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
const TAILSCALE_KEY = /^tskey-auth-[\w-]{10,200}$/
const TAILSCALE_INSTALL_MS = 170_000

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
    case 'containers':
      return { containers: await containerList() }
    case 'create':
      return create(req)
    case 'apply': {
      writeConf(req.id, req.files)
      if (await outdated(req.id, req.size)) {
        pairings.delete(req.id)
        await docker('rm', '-f', `ag-${req.id}`)
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
    case 'skills':
      return listSkills(skillsRoot(req.id))
    case 'skill-read':
      return { body: readSkill({ root: skillsRoot(req.id), path: req.path }) }
    case 'skill-write':
      writeSkill({ root: skillsRoot(req.id), path: req.path, body: req.body })
      return { written: req.path }
    case 'skill-rm':
      await removeSkill(req.id, req.path)
      return { removed: req.path }
    case 'memory':
      return readMemory(memoriesRoot(req.id))
    case 'memory-write':
      writeMemory({ root: memoriesRoot(req.id), target: req.target, body: req.body })
      return { written: req.target }
    case 'usage':
      return { usage: agentUsage(req.since) }
    case 'ts-up':
      return tailscaleUp(req.authKey)
    case 'ts-status':
      return tailscaleStatus()
    case 'ts-down':
      await run('tailscale', ['logout'], EXEC)
      return tailscaleStatus()
  }
}

function parseRequest(value: unknown): AgentdRequest {
  if (!isRecord(value)) throw new Error('bad request')
  const { cmd } = value
  switch (cmd) {
    case 'health':
    case 'ps':
    case 'containers':
    case 'update':
    case 'ts-status':
    case 'ts-down':
      return { cmd }
    case 'ts-up':
      if (typeof value.authKey !== 'string' || !TAILSCALE_KEY.test(value.authKey)) throw new Error('bad tailscale auth key')
      return { cmd, authKey: value.authKey }
    case 'usage':
      if (typeof value.since !== 'number' || !Number.isFinite(value.since)) throw new Error('bad since')
      return { cmd, since: value.since }
    case 'create':
      return { cmd, id: agentId(value.id), net: netOf(value.net), files: filesOf(value.files), size: sizeOf(value.size) }
    case 'apply':
      return { cmd, id: agentId(value.id), net: netOf(value.net), files: filesOf(value.files), size: sizeOf(value.size), restart: value.restart === true, force: value.force === true }
    case 'start':
    case 'stop':
    case 'rm':
    case 'wa-pair':
    case 'wa-unlink':
    case 'skills':
      return { cmd, id: agentId(value.id) }
    case 'skill-read':
    case 'skill-rm':
      return { cmd, id: agentId(value.id), path: skillPath(value.path) }
    case 'memory':
      return { cmd, id: agentId(value.id) }
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

function sizeOf(value: unknown): AgentSize {
  if (value === undefined) return 'standard'
  if (value !== 'standard' && value !== 'large' && value !== 'xlarge') throw new Error('bad size')
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

async function create({ id, net, files, size }: { id: string; net: number; files: AgentFiles; size: AgentSize }) {
  await mustHaveFirewall()
  makeHome(id)
  writeConf(id, files)
  await docker('network', 'rm', `ag-${id}`).catch(() => undefined)
  await docker('network', 'create', '--subnet', `10.200.${net}.0/24`, '--gateway', `10.200.${net}.1`, '--label', `openhut.agent=${id}`, `ag-${id}`)
  const digest = await docker('image', 'inspect', '--format', '{{index .RepoDigests 0}}', IMAGE).catch(() => IMAGE)
  await docker(
    'create',
    ...['--name', `ag-${id}`, '--hostname', id, '--restart', 'no'],
    ...['--label', `openhut.agent=${id}`, '--label', `agent.digest=${digest}`, '--label', `openhut.spec=${SPEC}`, '--label', `openhut.size=${size}`],
    ...['--runtime', 'runsc', '--user', `${AGENT_UID}:${AGENT_UID}`, '--init', '--entrypoint', '/opt/hermes/bin/hermes'],
    ...['--read-only', '--tmpfs', '/tmp:rw,nosuid,size=256m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'],
    ...['--pids-limit', '512', '--memory', SIZES[size].memory, '--cpus', SIZES[size].cpus, '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3'],
    ...['--network', `ag-${id}`, '--ip', `10.200.${net}.2`],
    ...Object.entries(AGENT_ENV).flatMap(([name, value]) => ['-e', `${name}=${value}`]),
    ...['--mount', 'type=bind,src=/etc/agentd/resolv.conf,dst=/etc/resolv.conf,readonly'],
    ...['--mount', `type=bind,src=${home(id)},dst=/opt/data`],
    ...['--mount', `type=bind,src=${home(id)}/platforms,dst=/opt/data/platforms`],
    ...['--mount', `type=bind,src=${home(id)}/.claude,dst=/opt/data/.claude`],
    ...FILES.flatMap((name) => readOnly(id, name, name)),
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
  const ids = (await docker('ps', '-q', '--filter', 'label=openhut.agent').catch(() => '')).split('\n').filter(Boolean)
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

async function containerList(): Promise<Container[]> {
  const out = await docker('ps', '-a', '--no-trunc', '--filter', 'label=openhut.agent', '--format', '{{json .}}')
  return out.split('\n').filter(Boolean).map((line) => {
    const row: unknown = JSON.parse(line)
    const field = (name: string) => isRecord(row) && typeof row[name] === 'string' ? row[name] : ''
    return {
      name: field('Names'), agentId: /(?:^|,)openhut\.agent=([^,]+)/.exec(field('Labels'))?.[1] ?? '', state: field('State'), status: field('Status'),
      image: field('Image'), createdAt: field('CreatedAt'), networks: field('Networks'),
    }
  })
}

async function containerStates() {
  const out = await docker('ps', '-a', '--filter', 'label=openhut.agent', '--format', '{{.Label "openhut.agent"}} {{.State}}')
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

async function outdated(id: string, size: AgentSize) {
  const made = await docker('inspect', '-f', 'spec={{index .Config.Labels "openhut.spec"}} size={{index .Config.Labels "openhut.size"}}', `ag-${id}`).catch(ignoreMissing)
  return made !== '' && made.replace(/size=$/, 'size=standard') !== `spec=${SPEC} size=${size}`
}

async function stale(id: string) {
  const started = Date.parse((await docker('inspect', '-f', '{{.State.StartedAt}}', `ag-${id}`)).replace(/(\.\d{3})\d+/, '$1'))
  return Math.max(...[...FILES, CLAUDE_SETTINGS_FILE].map((name) => statSync(`${conf(id)}/${name}`).mtimeMs)) > started
}

function writeConf(id: string, files: AgentFiles) {
  const dir = conf(id)
  mkdirSync(dir, { recursive: true })
  chownSync(dir, 0, AGENT_UID)
  chmodSync(dir, 0o750)
  for (const name of FILES) writeIfChanged(`${dir}/${name}`, files[name])
  writeIfChanged(`${dir}/${CLAUDE_SETTINGS_FILE}`, CLAUDE_SETTINGS)
}

function writeIfChanged(path: string, body: string) {
  if (!existsSync(path) || readFileSync(path, 'utf8') !== body) writeFileSync(path, body)
  chownSync(path, 0, AGENT_UID)
  chmodSync(path, 0o640)
}

function makeHome(id: string) {
  for (const sub of ['', '/.claude', '/home', '/platforms', '/scripts', '/scripts/whatsapp-bridge', '/skills']) {
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

function agentUsage(since: number): Record<string, number> {
  const usage: Record<string, number> = {}
  for (const id of readdirSync('/data/agents').filter((name) => ID.test(name))) {
    const file = `${home(id)}/state.db`
    if (!existsSync(file)) continue
    try {
      const db = new DatabaseSync(file, { readOnly: true })
      try {
        const row = db.prepare('SELECT COALESCE(SUM(estimated_cost_usd), 0) AS cost FROM sessions WHERE COALESCE(last_activity_at, started_at) >= ?').get(since)
        usage[id] = Number(row?.cost ?? 0)
      } finally {
        db.close()
      }
    } catch (e) {
      console.error(`usage ${id}: ${errorText(e)}`)
    }
  }
  return usage
}

async function removeSkill(id: string, path: string) {
  const digest = await docker('image', 'inspect', '--format', '{{index .RepoDigests 0}}', IMAGE).catch(() => IMAGE)
  await docker(
    'run', '--rm',
    ...['--runtime', 'runsc', '--user', `${AGENT_UID}:${AGENT_UID}`, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'],
    ...['--mount', `type=bind,src=${home(id)},dst=/opt/data`, '--entrypoint', 'rm'],
    ...[digest, '-rf', '--', `/opt/data/skills/${path}`],
  )
}

function memoriesRoot(id: string) {
  return `${realpathSync('/data/agents')}/${id}/memories`
}

function skillsRoot(id: string) {
  return `${realpathSync('/data/agents')}/${id}/skills`
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

async function tailscaleUp(authKey: string): Promise<Tailnet & { joined: boolean }> {
  if (!(await hasTailscale())) await run('sh', ['-c', 'curl -fsSL https://tailscale.com/install.sh | sh'], { ...EXEC, timeout: TAILSCALE_INSTALL_MS })
  const before = await tailscaleStatus()
  if (before.state === 'Running') return { ...before, joined: false }
  const keyFile = `${dirname(SOCK)}/tailscale.key`
  writeFileSync(keyFile, authKey, { mode: 0o600 })
  try {
    await run('tailscale', ['up', `--auth-key=file:${keyFile}`, '--hostname=openhut'], { ...EXEC, timeout: 120_000 })
  } finally {
    rmSync(keyFile, { force: true })
  }
  return { ...(await tailscaleStatus()), joined: true }
}

async function tailscaleStatus(): Promise<Tailnet> {
  if (!(await hasTailscale())) return { state: 'NotInstalled', tailnet: '', name: '', address: '' }
  const { stdout } = await run('tailscale', ['status', '--json'], EXEC).catch((e: unknown) => ({ stdout: isRecord(e) && typeof e.stdout === 'string' ? e.stdout : '{}' }))
  const status: unknown = JSON.parse(stdout || '{}')
  const field = (value: unknown, key: string) => isRecord(value) ? value[key] : undefined
  const ips = field(field(status, 'Self'), 'TailscaleIPs')
  return {
    state: String(field(status, 'BackendState') ?? 'Stopped'),
    tailnet: String(field(field(status, 'CurrentTailnet'), 'Name') ?? ''),
    name: String(field(field(status, 'Self'), 'DNSName') ?? '').replace(/\.$/, ''),
    address: Array.isArray(ips) ? String(ips[0] ?? '') : '',
  }
}

function hasTailscale(): Promise<boolean> {
  return run('sh', ['-c', 'command -v tailscale'], EXEC).then(() => true, () => false)
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
    await run('systemd-run', ['--unit=openhut-update', '--collect', '--quiet', `--setenv=OPENHUT_URL=${RELEASE_URL}`, '/bin/sh', '-c', UPDATE_SCRIPT])
  } else {
    spawn('/bin/sh', ['-c', `(${UPDATE_SCRIPT}) >> /var/log/openhut-boot.log 2>&1`], { detached: true, stdio: 'ignore', env: { ...process.env, OPENHUT_URL: RELEASE_URL } }).unref()
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

export type AgentSize = keyof typeof SIZES

export type AgentdRequest =
  | { cmd: 'health' }
  | { cmd: 'ps' | 'containers' }
  | { cmd: 'update' }
  | { cmd: 'create'; id: string; net: number; files: AgentFiles; size: AgentSize }
  | { cmd: 'apply'; id: string; net: number; files: AgentFiles; size: AgentSize; restart: boolean; force?: boolean }
  | { cmd: 'start' | 'stop' | 'rm' | 'wa-pair' | 'wa-unlink' | 'skills'; id: string }
  | { cmd: 'skill-read' | 'skill-rm'; id: string; path: string }
  | { cmd: 'memory'; id: string }
  | { cmd: 'memory-write'; id: string; target: MemoryTarget; body: string }
  | { cmd: 'skill-write'; id: string; path: string; body: string }
  | { cmd: 'usage'; since: number }
  | { cmd: 'ts-up'; authKey: string }
  | { cmd: 'ts-status' | 'ts-down' }

export type AgentdReplies = {
  health: { firewall: boolean; image: string; updating: boolean }
  ps: { states: Record<string, string> }
  containers: { containers: Container[] }
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
  usage: { usage: Record<string, number> }
  'ts-up': Tailnet & { joined: boolean }
  'ts-status': Tailnet
  'ts-down': Tailnet
}

export type Container = { name: string; agentId: string; state: string; status: string; image: string; createdAt: string; networks: string }

export type Tailnet = { state: string; tailnet: string; name: string; address: string }

export type Pairing = { status: 'starting' | 'qr' | 'linked' | 'error'; qr?: string; phone?: string; error?: string }

type AgentFiles = Record<string, string>
type Reply = AgentdReplies[keyof AgentdReplies]
