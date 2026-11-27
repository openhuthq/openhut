import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { hermesBox as runtime, type AgentFiles } from './adapters/hermes/index.ts'
import { browser, POLICY_FILE, policyOf } from './browser.ts'
import { config } from './config.ts'
import { AGENT_USER, box, conf, home, scratchSpec, TMP_MIB, writeIfChanged } from './host.ts'
import { firewall } from './network/firewall.ts'
import { ID, RESOLV } from './network/ports.ts'
import type { SandboxSpec, SandboxState } from './sandbox/sandbox.ts'

const TRASH = `${config.data}/trash`
const TRASH_MS = 30 * 24 * 60 * 60_000
const AGENT_MEMORY_MIB = 1024
const AGENT_CPUS = 1

export const agents = {
  async apply({ id, net, files, browser: on, running, force, restart }: Desired): Promise<{ applied: string; change: Change }> {
    const { promptsChanged } = runtime.writeConf(id, files)
    writeIfChanged(`${conf(id)}/${POLICY_FILE}`, policyOf(id))
    if (promptsChanged) await runtime.refreshPrompts(specOf({ id, net, browser: on }))
    const made = await sandboxOf(id)
    const recreate = !made || outdated({ made, want: specOf({ id, net, browser: on }) })
    if (!restart && !force && running && made?.running && (recreate || stale(made))) return { applied: id, change: 'pending' }
    if (recreate) {
      await firewall.require()
      if (on) await browser.prepare()
      runtime.makeHome(id)
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

  async removeInside({ id, guest }: { id: string; guest: string }): Promise<void> {
    const spec = { ...scratchSpec({ id, mounts: [{ host: home(id), guest: runtime.guest, readOnly: false }], tmpfs: [] }), entrypoint: 'rm', command: [] }
    const { code } = await box.run({ spec, command: ['-rf', '--', `${runtime.guest}/${guest}`] })
    if (code !== 0) throw new Error(`couldn't delete ${guest} (rm exited with ${code})`)
  },
}

async function start(id: string) {
  if (await agents.isRunning(id)) return
  runtime.beforeStart(id)
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

function outdated({ made, want }: { made: SandboxState; want: SandboxSpec }) {
  return Object.entries(want.labels).some(([name, value]) => made.labels[name] !== value)
}

function stale(made: SandboxState) {
  const started = made.startedAt ? Date.parse(made.startedAt.replace(/(\.\d{3})\d+/, '$1')) : 0
  return Math.max(...runtime.restartFiles.map((name) => Math.floor(statSync(`${conf(made.id)}/${name}`, { throwIfNoEntry: false })?.mtimeMs ?? 0))) > started
}

function specOf({ id, net, browser: on }: { id: string; net: number; browser: boolean }): SandboxSpec {
  const agent = runtime.spec(id)
  return {
    ...agent, id, image: config.image, cpus: AGENT_CPUS, memoryMib: on ? browser.memoryMib : AGENT_MEMORY_MIB, user: AGENT_USER,
    mounts: [{ host: RESOLV, guest: '/etc/resolv.conf', readOnly: true }, ...agent.mounts, ...(on ? browser.mounts(id) : [])],
    tmpfs: [{ guest: '/tmp', sizeMib: on ? browser.tmpMib : TMP_MIB }, ...agent.tmpfs],
    labels: { ...agent.labels, 'openhut.browser': on ? 'on' : 'off' },
    net,
  }
}

export type Change = 'created' | 'started' | 'restarted' | 'stopped' | 'pending' | 'none'
type Desired = { id: string; net: number; files: AgentFiles; browser: boolean; running: boolean; force: boolean; restart: boolean }
