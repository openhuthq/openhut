import { spawn, type ChildProcess } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { installWindowsSandboxAsync, resolveSrtWin, SandboxManager, VENDORED_SRT_WIN_EXE } from '@anthropic-ai/sandbox-runtime'
import { AGENT_API_PORT_BASE, type Exec, type Mount, type Sandboxes, type SandboxSpec, type SandboxState } from './sandbox.ts'

const WIN = process.platform === 'win32'
const DATA = resolve(process.env.AGENTD_DATA || '/data')
const STATE = join(DATA, 'native')
const RUNTIME = process.env.AGENTD_HERMES || join(DATA, 'runtime')
const PYTHON = WIN ? join(RUNTIME, 'python', 'python.exe') : join(RUNTIME, 'python', 'bin', 'python3')
const GATEWAY_PORT = Number(process.env.OPENHUT_GATEWAY_PORT ?? 8081)
const GATEWAY = `127.0.0.1:${GATEWAY_PORT}`
const KILL_MS = 10_000
const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', 'fc00::/7', 'fe80::/10', 'fd7a:115c:a1e0::/48']
const BASE_PATH = WIN ? `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32;${process.env.SystemRoot ?? 'C:\\Windows'}` : '/usr/bin:/bin:/usr/sbin:/sbin'

type Saved = { spec: SandboxSpec; pid?: number; startedAt?: string }

const children = new Map<string, ChildProcess>()
let ready: Promise<void> | undefined

function init() {
  ready ??= start().catch(async (e: unknown) => {
    if (!WIN) throw e
    await installWindowsSandboxAsync({ srtWin: resolveSrtWin({ path: VENDORED_SRT_WIN_EXE }), skipProfileGrant: true })
    return start()
  })
  return ready
}

function start() {
  return SandboxManager.initialize({
    network: { allowedDomains: [GATEWAY], deniedDomains: [], deniedResolvedAddresses: PRIVATE },
    filesystem: { denyRead: [], allowWrite: [], denyWrite: [] },
    ...(WIN ? { windows: { srtWin: { path: VENDORED_SRT_WIN_EXE } } } : {}),
  }, async ({ host, port }) => port === 443 && !/^[\d.:[\]]+$/.test(host))
}

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
  if (mount.guest.startsWith('/usr/local/bin/')) return link({ from: mount.host, to: join(binDir(spec), mount.guest.slice('/usr/local/bin/'.length)) })
  const parent = spec.mounts.filter((m) => m !== mount && mount.guest.startsWith(`${m.guest}/`)).sort((a, b) => b.guest.length - a.guest.length)[0]
  if (!parent) return
  const target = join(parent.host, mount.guest.slice(parent.guest.length))
  if (resolve(target) === resolve(mount.host)) return
  if (statSync(mount.host).isDirectory()) return link({ from: mount.host, to: target })
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(mount.host, target)
}

function link({ from, to }: { from: string; to: string }) {
  rmSync(to, { recursive: true, force: true })
  mkdirSync(dirname(to), { recursive: true })
  symlinkSync(from, to, WIN ? 'junction' : undefined)
}

function envOf(spec: SandboxSpec): Record<string, string> {
  const mapped = Object.fromEntries(Object.entries(spec.env).map(([name, value]) => [name, value.startsWith('/') ? hostOf({ spec, guest: value }) : value]))
  return { ...mapped, PATH: [binDir(spec), dirname(PYTHON), BASE_PATH].join(WIN ? ';' : ':'), TMPDIR: join(dirOf(spec.id), 'tmp'), TEMP: join(dirOf(spec.id), 'tmp'), TMP: join(dirOf(spec.id), 'tmp'), PYTHONNOUSERSITE: '1', NO_PROXY: '', no_proxy: '', LANG: 'en_US.UTF-8' }
}

function policyOf(spec: SandboxSpec) {
  const home = root(spec)
  const readable = [RUNTIME, dirOf(spec.id), ...spec.mounts.filter((m) => existsSync(m.host)).map((m) => m.host)]
  const writable = [dirOf(spec.id), ...spec.mounts.filter((m) => !m.readOnly && existsSync(m.host)).map((m) => m.host)]
  const locked = [...spec.mounts.filter((m) => m.readOnly && home && m.guest.startsWith('/opt/data/')).map((m) => hostOf({ spec, guest: m.guest })), ...spec.tmpfs.filter((t) => t.readOnly).map((t) => hostOf({ spec, guest: t.guest }))]
  return {
    filesystem: { denyRead: [homedir(), DATA], allowRead: readable, allowWrite: writable, denyWrite: [RUNTIME, ...locked] },
  }
}

function portRules(spec: SandboxSpec) {
  const sockets = [root(spec), dirOf(spec.id)].filter((dir): dir is string => Boolean(dir) && existsSync(dir as string)).map((dir) => JSON.stringify(realpathSync(dir)))
  const unix = `(allow system-socket (socket-domain AF_UNIX))${sockets.map((dir) => `(allow network-bind (local unix-socket (subpath ${dir})))(allow network-outbound (remote unix-socket (subpath ${dir})))`).join('')}`
  return `${unix}(allow network-outbound (remote ip "localhost:${GATEWAY_PORT}"))(allow network-bind (local ip "localhost:*"))(allow network-inbound (local ip "localhost:*"))`
}

function argvOf({ spec, command }: { spec: SandboxSpec; command: string[] }) {
  const [first, ...rest] = command.map((part) => part.startsWith('/') ? hostOf({ spec, guest: part }) : part)
  const launcher = first === PYTHON ? [PYTHON, '-s', join(RUNTIME, 'hermes.py')] : [first]
  return [...launcher, ...rest].map(quote).join(' ')
}

function quote(part: string) {
  if (WIN) return /[\s"]/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part
  return `'${part.replace(/'/g, `'\\''`)}'`
}

async function boxed({ spec, command }: { spec: SandboxSpec; command: string[] }) {
  await init()
  const wrapped = await SandboxManager.wrapWithSandboxArgv(argvOf({ spec, command }), undefined, policyOf(spec), undefined, root(spec))
  const argv = WIN ? wrapped.argv : wrapped.argv.map((part) => part.includes('(version 1)') ? part.replace('(version 1)', `(version 1)${portRules(spec)}`) : part)
  return spawn(argv[0], argv.slice(1), { cwd: root(spec), env: { ...envOf(spec), ...wrapped.env, ...envOf(spec), HTTPS_PROXY: wrapped.env.HTTPS_PROXY ?? '', HTTP_PROXY: wrapped.env.HTTP_PROXY ?? '' }, detached: !WIN, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
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

function kill({ pid, signal }: { pid: number; signal: NodeJS.Signals }) {
  if (WIN) return void spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', windowsHide: true })
  try {
    process.kill(-pid, signal)
  } catch {
    try {
      process.kill(pid, signal)
    } catch {
      return
    }
  }
}

async function halt({ id, seconds }: { id: string; seconds: number }) {
  const saved = savedOf(id)
  if (!saved?.pid || !alive(saved.pid)) return
  kill({ pid: saved.pid, signal: 'SIGTERM' })
  for (const end = Date.now() + Math.min(seconds * 1000, KILL_MS); Date.now() < end && alive(saved.pid);) await new Promise((r) => setTimeout(r, 200))
  if (alive(saved.pid)) kill({ pid: saved.pid, signal: 'SIGKILL' })
  save(id, { ...saved, pid: undefined })
}

function streamed(child: ChildProcess): Exec {
  const stdout = new PassThrough()
  child.stdout?.pipe(stdout, { end: false })
  child.stderr?.pipe(stdout, { end: false })
  const exit = new Promise<number>((done) => child.on('close', (code) => {
    stdout.end()
    done(code ?? 1)
  }))
  return { stdin: child.stdin, stdout, exit, kill: () => kill({ pid: child.pid ?? 0, signal: 'SIGKILL' }) }
}

export const native: Sandboxes = {
  name: 'native',

  async ready() {
    if (!existsSync(PYTHON)) return { ok: false, reason: `the agent runtime isn't installed at ${RUNTIME}` }
    return init().then(() => ({ ok: true }), (e: unknown) => {
      ready = undefined
      return { ok: false, reason: e instanceof Error ? e.message : String(e) }
    })
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
    const child = await boxed({ spec: saved.spec, command: [saved.spec.entrypoint, ...saved.spec.command] })
    const log = join(dirOf(id), 'agent.log')
    writeFileSync(log, '')
    child.stdout?.on('data', (chunk: Buffer) => writeFileSync(log, chunk, { flag: 'a' }))
    child.stderr?.on('data', (chunk: Buffer) => writeFileSync(log, chunk, { flag: 'a' }))
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
    const child = await boxed({ spec: saved.spec, command })
    if (!stdin) child.stdin?.end()
    return streamed(child)
  },

  async run({ spec, command }) {
    const scratch = { ...spec, id: `run-${spec.id}`, net: undefined }
    mkdirSync(dirOf(scratch.id), { recursive: true })
    try {
      layout(scratch)
      const result = streamed(await boxed({ spec: scratch, command: [spec.entrypoint, ...command] }))
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
    if (saved?.pid && alive(saved.pid)) kill({ pid: saved.pid, signal: 'SIGKILL' })
    if (saved) save(id, { ...saved, pid: undefined })
  }
}
