import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import type { Exec, Mount, Sandboxes, SandboxSpec, SandboxState } from './sandbox.ts'

const WIN = process.platform === 'win32'
const DATA = resolve(process.env.AGENTD_DATA || '/data')
const STATE = join(DATA, 'native')
export const RUNTIME = process.env.AGENTD_HERMES || join(DATA, 'runtime')
const PYTHON = WIN ? join(RUNTIME, 'python', 'python.exe') : join(RUNTIME, 'python', 'bin', 'python3')
const KILL_MS = 10_000
const BASE_PATH = WIN ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32;${process.env.SystemRoot ?? 'C:\\Windows'}` : '/usr/bin:/bin:/usr/sbin:/sbin'

type Saved = { spec: SandboxSpec; pid?: number; startedAt?: string }

const children = new Map<string, ChildProcess>()
const dirOf = (id: string) => join(STATE, id)
const savedOf = (id: string): Saved | undefined => existsSync(join(dirOf(id), 'spec.json')) ? JSON.parse(readFileSync(join(dirOf(id), 'spec.json'), 'utf8')) as Saved : undefined
const save = (id: string, saved: Saved) => writeFileSync(join(dirOf(id), 'spec.json'), JSON.stringify(saved))

export function hostOf({ spec, guest }: { spec: SandboxSpec; guest: string }): string {
  if (guest === '/opt/hermes/bin/hermes') return PYTHON
  if (guest === '/tmp' || guest.startsWith('/tmp/')) return join(dirOf(spec.id), 'tmp', guest.slice(4))
  const mount = spec.mounts.filter((m) => guest === m.guest || guest.startsWith(`${m.guest}/`)).sort((a, b) => b.guest.length - a.guest.length)[0]
  return mount ? join(mount.host, guest.slice(mount.guest.length)) : guest
}

function root(spec: SandboxSpec) {
  return spec.mounts.find((m) => m.guest === '/opt/data')?.host
}

function binDir(spec: SandboxSpec) {
  return join(dirOf(spec.id), 'bin')
}

export function layout(spec: SandboxSpec) {
  mkdirSync(join(dirOf(spec.id), 'tmp'), { recursive: true })
  mkdirSync(binDir(spec), { recursive: true })
  for (const m of spec.mounts) placeMount({ spec, mount: m })
  for (const t of spec.tmpfs.filter((each) => each.guest !== '/tmp')) mkdirSync(hostOf({ spec, guest: t.guest }), { recursive: true })
}

function placeMount({ spec, mount }: { spec: SandboxSpec; mount: Mount }) {
  if (!existsSync(mount.host) || mount.guest === '/etc/resolv.conf') return
  if (mount.guest.startsWith('/usr/local/bin/')) return tool({ from: mount.host, to: join(binDir(spec), mount.guest.slice('/usr/local/bin/'.length) + extname(mount.host)) })
  const parent = spec.mounts.filter((m) => m !== mount && mount.guest.startsWith(`${m.guest}/`)).sort((a, b) => b.guest.length - a.guest.length)[0]
  if (!parent) return
  const target = join(parent.host, mount.guest.slice(parent.guest.length))
  if (resolve(target) === resolve(mount.host)) return
  if (statSync(mount.host).isDirectory()) return link({ from: mount.host, to: target })
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(mount.host, target)
}

function tool({ from, to }: { from: string; to: string }) {
  if (!WIN) return link({ from, to })
  clear(to)
  try {
    linkSync(from, to)
  } catch {
    copyFileSync(from, to)
  }
}

function link({ from, to }: { from: string; to: string }) {
  clear(to)
  mkdirSync(dirname(to), { recursive: true })
  if (WIN) return cpSync(from, to, { recursive: true })
  symlinkSync(from, to)
}

function clear(path: string) {
  if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) return unlinkSync(path)
  rmSync(path, { recursive: true, force: true })
}

function envOf(spec: SandboxSpec): Record<string, string> {
  const mapped = Object.fromEntries(Object.entries(spec.env).map(([name, value]) => [name, value.startsWith('/') && !value.startsWith(DATA) ? hostOf({ spec, guest: value }) : value]))
  return { ...mapped, PATH: [binDir(spec), join(RUNTIME, 'node'), dirname(PYTHON), BASE_PATH].join(WIN ? ';' : ':'), TMPDIR: join(dirOf(spec.id), 'tmp'), TEMP: join(dirOf(spec.id), 'tmp'), TMP: join(dirOf(spec.id), 'tmp'), PYTHONNOUSERSITE: '1', LANG: 'en_US.UTF-8' }
}

function argvOf({ spec, command }: { spec: SandboxSpec; command: string[] }) {
  const [first, ...rest] = command.map((part) => part.startsWith('/') ? hostOf({ spec, guest: part }) : part)
  return first === PYTHON ? [PYTHON, '-s', join(RUNTIME, 'hermes.py'), ...rest] : [first, ...rest]
}

function launch({ spec, command }: { spec: SandboxSpec; command: string[] }) {
  const [file, ...args] = argvOf({ spec, command })
  return spawn(file, args, { cwd: root(spec) ?? dirOf(spec.id), env: envOf(spec), detached: !WIN, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
}

function alive(pid: number | undefined) {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function tree(pid: number): number[] {
  if (WIN) return [pid]
  const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=']).toString().trim().split('\n').map((line) => line.trim().split(/\s+/).map(Number))
  const found = [pid]
  for (let i = 0; i < found.length; i++) for (const [child, parent] of rows) if (parent === found[i] && !found.includes(child)) found.push(child)
  return found
}

function kill({ pids, signal }: { pids: number[]; signal: NodeJS.Signals }) {
  if (WIN) return void spawn('taskkill', ['/T', '/F', '/PID', String(pids[0])], { stdio: 'ignore', windowsHide: true })
  for (const pid of pids) {
    for (const target of [-pid, pid]) {
      try {
        process.kill(target, signal)
      } catch {
        continue
      }
    }
  }
}

async function halt({ id, seconds }: { id: string; seconds: number }) {
  const saved = savedOf(id)
  if (!saved?.pid || !alive(saved.pid)) return
  const pids = tree(saved.pid)
  kill({ pids, signal: 'SIGTERM' })
  for (const end = Date.now() + Math.min(seconds * 1000, KILL_MS); Date.now() < end && pids.some(alive);) await new Promise((r) => setTimeout(r, 200))
  kill({ pids: pids.filter(alive), signal: 'SIGKILL' })
  closeBrowser(saved.spec)
  save(id, { ...saved, pid: undefined })
}

function closeBrowser(spec: SandboxSpec) {
  const dir = spec.env.AGENT_BROWSER_SOCKET_DIR
  if (!dir || !existsSync(dir)) return
  for (const name of readdirSync(dir).filter((each) => each.endsWith('.pid'))) {
    const pid = Number(readFileSync(join(dir, name), 'utf8'))
    if (pid && alive(pid)) kill({ pids: tree(pid), signal: 'SIGKILL' })
  }
}

function streamed(child: ChildProcess): Exec {
  const stdout = new PassThrough()
  child.stdout?.pipe(stdout, { end: false })
  child.stderr?.pipe(stdout, { end: false })
  const exit = new Promise<number>((done) => {
    child.on('error', (error) => {
      stdout.end(`${error.message}\n`)
      done(127)
    })
    child.on('close', (code) => {
      stdout.end()
      done(code ?? 1)
    })
  })
  return { stdin: child.stdin, stdout, exit, kill: () => kill({ pids: tree(child.pid ?? 0), signal: 'SIGKILL' }) }
}

export const native: Sandboxes = {
  name: 'native',

  async ready() {
    return existsSync(PYTHON) ? { ok: true } : { ok: false, reason: `the agent runtime isn't installed at ${RUNTIME}` }
  },

  async create(spec) {
    await native.remove(spec.id)
    mkdirSync(dirOf(spec.id), { recursive: true })
    save(spec.id, { spec })
  },

  async start(id) {
    const saved = savedOf(id)
    if (!saved) throw new Error(`No such container: ag-${id}`)
    if (alive(saved.pid)) return
    layout(saved.spec)
    const child = launch({ spec: saved.spec, command: [saved.spec.entrypoint, ...saved.spec.command] })
    const log = join(dirOf(id), 'agent.log')
    writeFileSync(log, '')
    child.stdout?.on('data', (chunk: Buffer) => writeFileSync(log, chunk, { flag: 'a' }))
    child.stderr?.on('data', (chunk: Buffer) => writeFileSync(log, chunk, { flag: 'a' }))
    child.on('error', (error) => writeFileSync(log, `${error.message}\n`, { flag: 'a' }))
    child.on('exit', () => children.delete(id))
    children.set(id, child)
    save(id, { ...saved, pid: child.pid, startedAt: new Date().toISOString() })
  },

  async stop({ id, seconds }) {
    await halt({ id, seconds })
  },

  async remove(id) {
    await halt({ id, seconds: 2 })
    rmSync(dirOf(id), { recursive: true, force: true })
  },

  async exec({ id, command, stdin }) {
    const saved = savedOf(id)
    if (!saved || !alive(saved.pid)) throw new Error(`ag-${id} is not running`)
    const child = launch({ spec: saved.spec, command })
    if (!stdin) child.stdin?.end()
    return streamed(child)
  },

  async run({ spec, command }) {
    const scratch = { ...spec, id: `run-${spec.id}`, net: undefined }
    mkdirSync(dirOf(scratch.id), { recursive: true })
    try {
      layout(scratch)
      const result = streamed(launch({ spec: scratch, command: [spec.entrypoint, ...command] }))
      result.stdin?.end()
      const chunks: Buffer[] = []
      result.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
      const code = await result.exit
      return { code, stdout: Buffer.concat(chunks).toString('utf8') }
    } finally {
      rmSync(dirOf(scratch.id), { recursive: true, force: true })
    }
  },

  async list() {
    if (!existsSync(STATE)) return []
    return readdirSync(STATE).flatMap((id): SandboxState[] => {
      const saved = savedOf(id)
      if (!saved) return []
      return [{ id, running: alive(saved.pid), startedAt: saved.startedAt, labels: saved.spec.labels }]
    })
  },

  async progress() {
    return null
  },
}

export function sweep() {
  if (!existsSync(STATE)) return
  for (const id of readdirSync(STATE)) {
    const saved = savedOf(id)
    if (!saved) continue
    if (saved.pid && alive(saved.pid)) kill({ pids: tree(saved.pid), signal: 'SIGKILL' })
    save(id, { ...saved, pid: undefined })
  }
  for (const id of readdirSync(STATE)) {
    const saved = savedOf(id)
    if (saved) closeBrowser(saved.spec)
  }
}
