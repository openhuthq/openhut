import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync } from 'node:fs'
import { browser, POLICY_FILE, policyOf } from './browser.ts'
import { config } from './config.ts'
import { AGENT_UID, AGENT_USER, box, CLAUDE, conf, home, own, scratchSpec, TMP_MIB, writeIfChanged } from './host.ts'
import { firewall } from './network/firewall.ts'
import { ID, RESOLV } from './network/ports.ts'
import type { Mount, SandboxSpec, SandboxState } from './sandbox/sandbox.ts'
import { whatsapp } from './whatsapp.ts'

export const FILES = ['config.yaml', '.env', 'SOUL.md', 'auth.json'] as const
export const RESTART_KEY = 'restart.key'
const PLUGINS = `${config.assets}/vendor/hermes-plugins`
const MOUNTS = createHash('sha256').update(`${PLUGINS}\n${CLAUDE}`).digest('hex').slice(0, 16)
const SPEC = '4'
const TRASH = `${config.data}/trash`
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
  async apply({ id, net, files, browser: on, running, force, restart }: Desired): Promise<{ applied: string; change: Change }> {
    const soulChanged = writeConf(id, files)
    if (soulChanged) await refreshPrompts({ id, net, browser: on })
    const made = await sandboxOf(id)
    const recreate = !made || outdated({ made, browser: on })
    if (!restart && !force && running && made?.running && (recreate || stale(made))) return { applied: id, change: 'pending' }
    if (recreate) {
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
      await firewall.require()
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

  ids(): string[] {
    return readdirSync(`${config.data}/agents`).filter((name) => ID.test(name))
  },

  async removeInside({ id, guest }: { id: string; guest: string }): Promise<void> {
    const spec = { ...scratchSpec({ id, mounts: [{ host: home(id), guest: '/opt/data', readOnly: false }], tmpfs: [] }), entrypoint: 'rm', command: [] }
    const { code } = await box.run({ spec, command: ['-rf', '--', `/opt/data/${guest}`] })
    if (code !== 0) throw new Error(`couldn't delete ${guest} (rm exited with ${code})`)
  },
}

async function start(id: string) {
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
  const { labels } = made
  return labels['openhut.spec'] !== SPEC || (labels['openhut.browser'] || 'off') !== (on ? 'on' : 'off') || labels['openhut.mounts'] !== MOUNTS
}

function stale(made: SandboxState) {
  const started = made.startedAt ? Date.parse(made.startedAt.replace(/(\.\d{3})\d+/, '$1')) : 0
  return Math.max(...[RESTART_KEY, CLAUDE_SETTINGS_FILE].map((name) => Math.floor(statSync(`${conf(made.id)}/${name}`, { throwIfNoEntry: false })?.mtimeMs ?? 0))) > started
}

function specOf({ id, net, browser: on }: { id: string; net: number; browser: boolean }): SandboxSpec {
  return {
    id, image: config.image, cpus: AGENT_CPUS, memoryMib: on ? browser.memoryMib : AGENT_MEMORY_MIB,
    user: AGENT_USER, entrypoint: '/opt/hermes/bin/hermes', command: ['gateway', 'run'], env: AGENT_ENV,
    mounts: [
      { host: RESOLV, guest: '/etc/resolv.conf', readOnly: true },
      { host: home(id), guest: '/opt/data', readOnly: false },
      { host: `${home(id)}/platforms`, guest: '/opt/data/platforms', readOnly: false },
      { host: `${home(id)}/.claude`, guest: '/opt/data/.claude', readOnly: false },
      ...FILES.map((name) => confMount({ id, name, guest: name })),
      confMount({ id, name: CLAUDE_SETTINGS_FILE, guest: '.claude/settings.json' }),
      { host: PLUGINS, guest: '/opt/data/plugins', readOnly: true },
      { host: CLAUDE, guest: '/usr/local/bin/claude', readOnly: true },
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
  const had = envKeys(`${dir}/.env`)
  const changed = FILES.filter((name) => writeIfChanged(`${dir}/${name}`, files[name]))
  const key = `${dir}/${RESTART_KEY}`
  writeIfChanged(key, files[RESTART_KEY] ?? `${createHash('sha256').update(FILES.map((name) => files[name]).join('\0')).digest('hex')}\n`)
  const kept = envKeys(`${dir}/.env`)
  if ([...had].some((name) => !kept.has(name))) utimesSync(key, new Date(), new Date())
  writeIfChanged(`${dir}/${CLAUDE_SETTINGS_FILE}`, CLAUDE_SETTINGS)
  writeIfChanged(`${dir}/${POLICY_FILE}`, policyOf(id))
  return changed.includes('SOUL.md')
}

function envKeys(path: string): Set<string> {
  return new Set(existsSync(path) ? readFileSync(path, 'utf8').split('\n').map((line) => line.split('=')[0]).filter(Boolean) : [])
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

export type AgentFiles = Record<(typeof FILES)[number], string> & { [RESTART_KEY]?: string }
export type Change = 'created' | 'started' | 'restarted' | 'stopped' | 'pending' | 'none'
type Desired = { id: string; net: number; files: AgentFiles; browser: boolean; running: boolean; force: boolean; restart: boolean }
