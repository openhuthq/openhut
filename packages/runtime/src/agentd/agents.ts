import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { browser, POLICY_FILE, policyOf } from './browser.ts'
import { firewall } from './firewall.ts'
import { join } from 'node:path'
import { AGENT_UID, AGENT_USER, ASSETS, BIN, box, conf, DATA, EXE, home, ID, IMAGE, own, RESOLV, TMP_MIB, writeIfChanged } from './host.ts'
import type { Mount, SandboxSpec, SandboxState } from './sandbox/sandbox.ts'
import { whatsapp } from './whatsapp.ts'

export const FILES = ['config.yaml', '.env', 'SOUL.md', 'auth.json'] as const
const PLUGINS = `${ASSETS}/vendor/hermes-plugins`
const CLAUDE_BIN = join(BIN, `claude${EXE}`)
const MOUNTS = createHash('sha256').update(`${PLUGINS}\n${CLAUDE_BIN}`).digest('hex').slice(0, 16)
const SPEC = '4'
const TRASH = `${DATA}/trash`
const TRASH_MS = 30 * 24 * 60 * 60_000
const AGENT_MEMORY_MIB = 1024
const AGENT_CPUS = 1
const CLAUDE_SETTINGS_FILE = 'claude-settings.json'
const CLAUDE_SETTINGS = JSON.stringify({ disableAllHooks: true, cleanupPeriodDays: 1 }) + '\n'
const HERMES_RUNTIME_FILES = ['gateway.pid', 'gateway.lock', 'gateway_state.json']
const HOME_DIRS = ['', '/.claude', '/home', '/platforms', '/scripts', '/scripts/whatsapp-bridge', '/skills']
const LOCKED_TMPFS = ['/opt/data/hooks', '/opt/data/pairing', '/opt/data/platforms/pairing']
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

export const agents = {
  async apply({ id, net, files, browser: on, running, force }: Desired): Promise<{ applied: string; change: Change }> {
    const soulChanged = writeConf(id, files)
    if (soulChanged) await refreshPrompts({ id, net, browser: on })
    const made = await sandboxOf(id)
    if (!made || outdated({ made, browser: on })) {
      await firewall.require()
      if (on) await browser.prepare()
      makeHome(id)
      await box.create(specOf({ id, net, browser: on }))
      if (running) await start(id)
      return { applied: id, change: 'created' }
    }
    if (!running) {
      if (made.running) await box.stop({ id, seconds: 10 })
      return { applied: id, change: made.running ? 'stopped' : 'none' }
    }
    if (!made.running) {
      await start(id)
      return { applied: id, change: 'started' }
    }
    if (!force && !stale(made)) return { applied: id, change: 'none' }
    await agents.restart(id)
    return { applied: id, change: 'restarted' }
  },

  async stop(id: string): Promise<{ stopped: string }> {
    await box.stop({ id, seconds: 10 })
    return { stopped: id }
  },

  async restart(id: string): Promise<void> {
    await firewall.require()
    await box.stop({ id, seconds: 10 })
    await start(id)
  },

  async remove(id: string, trash = false): Promise<{ removed: string }> {
    await box.remove(id)
    if (trash) {
      const kept = `${TRASH}/${Date.now()}-${id}`
      mkdirSync(kept, { recursive: true, mode: 0o700 })
      for (const [from, name] of [[home(id), 'home'], [conf(id), 'conf']]) if (existsSync(from)) renameSync(from, `${kept}/${name}`)
    }
    rmSync(home(id), { recursive: true, force: true })
    rmSync(conf(id), { recursive: true, force: true })
    for (const old of existsSync(TRASH) ? readdirSync(TRASH) : []) if (Date.now() - Number(old.split('-')[0]) > TRASH_MS) rmSync(`${TRASH}/${old}`, { recursive: true, force: true })
    return { removed: id }
  },

  async states(): Promise<Record<string, string>> {
    return Object.fromEntries((await list()).map((each) => [each.id, stateText(each)]))
  },

  async isRunning(id: string): Promise<boolean> {
    return (await sandboxOf(id))?.running === true
  },

  async exists(id: string): Promise<boolean> {
    return (await sandboxOf(id)) !== undefined
  },

  makeHome,

  ids(): string[] {
    return readdirSync(`${DATA}/agents`).filter((name) => ID.test(name))
  },

  async removeInside({ id, guest }: { id: string; guest: string }): Promise<void> {
    if (box.name === 'native') return rmSync(`${home(id)}/${guest}`, { recursive: true, force: true })
    const spec: SandboxSpec = {
      id, image: IMAGE, cpus: 1, memoryMib: TMP_MIB, user: AGENT_USER, entrypoint: 'rm', command: [], env: {},
      mounts: [{ host: home(id), guest: '/opt/data', readOnly: false }], tmpfs: [], labels: {},
    }
    const { code } = await box.run({ spec, command: ['-rf', '--', `/opt/data/${guest}`] })
    if (code !== 0) throw new Error(`couldn't delete ${guest} (rm exited with ${code})`)
  },
}

async function start(id: string) {
  await firewall.require()
  if (await agents.isRunning(id)) return
  for (const name of HERMES_RUNTIME_FILES) rmSync(`${home(id)}/${name}`, { force: true })
  await box.start(id)
}

async function list() {
  return (await box.list()).filter((each) => ID.test(each.id))
}

async function sandboxOf(id: string) {
  return (await list()).find((each) => each.id === id)
}

function stateText({ running, startedAt }: SandboxState) {
  if (running) return 'running'
  return startedAt ? 'exited' : 'created'
}

function outdated({ made, browser: on }: { made: SandboxState; browser: boolean }) {
  const labels = made.labels
  return `${labels['openhut.spec'] ?? ''} ${labels['openhut.browser'] || 'off'} ${labels['openhut.mounts'] ?? ''}` !== `${SPEC} ${on ? 'on' : 'off'} ${MOUNTS}`
}

function stale(made: SandboxState) {
  const started = made.startedAt ? Date.parse(made.startedAt.replace(/(\.\d{3})\d+/, '$1')) : 0
  return Math.max(...[...FILES, CLAUDE_SETTINGS_FILE].map((name) => Math.floor(statSync(`${conf(made.id)}/${name}`).mtimeMs))) > started
}

function specOf({ id, net, browser: on }: { id: string; net: number; browser: boolean }): SandboxSpec {
  return {
    id, image: IMAGE, cpus: AGENT_CPUS, memoryMib: on ? browser.memoryMib : AGENT_MEMORY_MIB,
    user: AGENT_USER, entrypoint: '/opt/hermes/bin/hermes', command: ['gateway', 'run'], env: on ? { ...AGENT_ENV, ...browser.env({ id, net }) } : AGENT_ENV,
    mounts: [
      { host: RESOLV, guest: '/etc/resolv.conf', readOnly: true },
      { host: home(id), guest: '/opt/data', readOnly: false },
      { host: `${home(id)}/platforms`, guest: '/opt/data/platforms', readOnly: false },
      { host: `${home(id)}/.claude`, guest: '/opt/data/.claude', readOnly: false },
      ...FILES.map((name) => confMount({ id, name, guest: name })),
      confMount({ id, name: CLAUDE_SETTINGS_FILE, guest: '.claude/settings.json' }),
      { host: PLUGINS, guest: '/opt/data/plugins', readOnly: true },
      { host: CLAUDE_BIN, guest: '/usr/local/bin/claude', readOnly: true },
      ...whatsapp.mounts(),
      ...(on ? browser.mounts(id) : []),
    ],
    tmpfs: [{ guest: '/tmp', sizeMib: on ? browser.tmpMib : TMP_MIB }, ...LOCKED_TMPFS.map((guest) => ({ guest, sizeMib: 4 / 1024, readOnly: true }))],
    labels: { 'openhut.spec': SPEC, 'openhut.browser': on ? 'on' : 'off', 'openhut.mounts': MOUNTS },
    net,
  }
}

function confMount({ id, name, guest }: { id: string; name: string; guest: string }): Mount {
  return { host: `${conf(id)}/${name}`, guest: `/opt/data/${guest}`, readOnly: true }
}

function writeConf(id: string, files: AgentFiles) {
  const dir = conf(id)
  mkdirSync(dir, { recursive: true })
  own({ path: dir, uid: 0, gid: AGENT_UID, mode: 0o750 })
  const changed = FILES.filter((name) => writeIfChanged(`${dir}/${name}`, files[name]))
  writeIfChanged(`${dir}/${CLAUDE_SETTINGS_FILE}`, CLAUDE_SETTINGS)
  writeIfChanged(`${dir}/${POLICY_FILE}`, policyOf(id))
  return changed.includes('SOUL.md')
}

async function refreshPrompts({ id, net, browser: on }: { id: string; net: number; browser: boolean }) {
  if (!existsSync(`${home(id)}/state.db`)) return
  const { code, stdout } = await box.run({ spec: specOf({ id, net, browser: on }), command: ['sessions', 'refresh-prompts'] })
  if (code !== 0) console.error(`${id}: hermes sessions refresh-prompts exited with ${code}: ${stdout.trim()}`)
}

function makeHome(id: string) {
  for (const sub of HOME_DIRS) {
    const dir = `${home(id)}${sub}`
    mkdirSync(dir, { recursive: true })
    own({ path: dir, uid: AGENT_UID, gid: AGENT_UID, mode: 0o700 })
  }
}

export type AgentFiles = Record<(typeof FILES)[number], string>
export type Change = 'created' | 'started' | 'restarted' | 'stopped' | 'none'
type Desired = { id: string; net: number; files: AgentFiles; browser: boolean; running: boolean; force: boolean }
