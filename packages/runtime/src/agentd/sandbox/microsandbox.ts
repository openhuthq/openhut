import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { PassThrough, Writable } from 'node:stream'
import { DnsBuilder, NetworkPolicy, Sandbox, SandboxNotFoundError } from 'microsandbox'
import type { ExecHandle, SandboxBuilder, SandboxHandle } from 'microsandbox'
import { errorText } from '../util.ts'
import { AGENT_API_PORT_BASE, type Pull, type Sandboxes, type SandboxSpec, type SandboxState } from './sandbox.ts'

const STOP_SECONDS = 10
const KILL_MS = 10_000
const RESTING = ['stopped', 'created', 'crashed']
const LIVE_JOB = ['starting', 'running']
const API_PORT = 8642
const WINDOWS_DNS = ['1.1.1.1', '8.8.8.8']

type Workload = { entrypoint: string[]; cmd: string[]; user: string }

const nameOf = (id: string) => `ag-${id}`
let pull: Pull | null = null

async function pulled(builder: SandboxBuilder) {
  const job = await builder.createWithPullProgress()
  const layers = new Map<number, number>()
  const watch = (async () => {
    for await (const event of job) {
      if (event.totalDownloadBytes) pull = { done: 0, total: event.totalDownloadBytes, unit: 'bytes' }
      if (pull && event.layerIndex !== undefined && event.downloadedBytes !== undefined) {
        layers.set(event.layerIndex, event.downloadedBytes)
        pull = { ...pull, done: Math.min(pull.total, [...layers.values()].reduce((sum, bytes) => sum + bytes, 0)) }
      }
    }
  })().catch(() => undefined)
  try {
    return await job.awaitSandbox()
  } finally {
    await watch
    pull = null
  }
}

function policy() {
  return NetworkPolicy.builder()
    .defaultEgress('deny')
    .defaultIngress('allow')
    .egress((e) => e.tcp().port(443).allowPublic())
    .egress((e) => e.udp().tcp().port(53).allowHost())
    .egress((e) => e.tcp().port(8081).allowHost())
}

function builder({ name, spec }: { name: string; spec: SandboxSpec }) {
  const b = Sandbox.builder(name)
    .image(spec.image)
    .cpus(spec.cpus)
    .memory(spec.memoryMib)
    .user(spec.user)
    .entrypoint([spec.entrypoint])
    .cmd(spec.command)
    .envs(spec.env)
    .labels(spec.labels)
    .security('restricted')
    .network((n) => (process.platform === 'win32' ? n.policy(policy()).dns((d: InstanceType<typeof DnsBuilder>) => d.nameservers(WINDOWS_DNS)) : n.policy(policy())))
    .detached(true)
    .replace()
  if (spec.net !== undefined) b.portBind('127.0.0.1', AGENT_API_PORT_BASE + spec.net, API_PORT)
  for (const m of spec.mounts.filter((each) => each.guest !== '/etc/resolv.conf')) {
    if (!existsSync(m.host)) throw new Error(`${m.host} is missing, so ${spec.id} can't get ${m.guest}; install OpenHut again`)
    b.volume(m.guest, (v) => (m.readOnly ? v.bind(m.host).readonly() : v.bind(m.host)))
  }
  for (const t of spec.tmpfs) b.volume(t.guest, (v) => {
    const fs = v.tmpfs().size(Math.max(1, Math.ceil(t.sizeMib)))
    return t.readOnly ? fs.readonly() : fs
  })
  return b
}

async function find(id: string) {
  return Sandbox.get(nameOf(id)).catch((e: unknown) => {
    if (e instanceof SandboxNotFoundError) return undefined
    throw e
  })
}

async function workloadJob(handle: SandboxHandle) {
  const page = await handle.listJobs()
  return page.items.find((job) => LIVE_JOB.includes(job.state))
}

function streamed(handle: ExecHandle) {
  const stdout = new PassThrough()
  const exit = (async () => {
    for await (const event of handle) {
      if (event.kind === 'stdout') stdout.write(event.data)
      if (event.kind === 'exited') {
        stdout.end()
        return event.code
      }
    }
    stdout.end()
    return (await handle.wait()).code
  })()
  return { stdout, exit }
}

function sinkOf(handle: ExecHandle) {
  const sink = handle.takeStdin()
  return new Writable({
    write(chunk: Buffer, _encoding, done) {
      sink.then((s) => s?.write(chunk)).then(() => done(), done)
    },
    final(done) {
      sink.then((s) => s?.close()).then(() => done(), done)
    },
  })
}

export const microsandbox: Sandboxes = {
  name: 'microsandbox',

  async ready() {
    try {
      await Sandbox.list()
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: errorText(e) }
    }
  },

  async create(spec) {
    const sandbox = await pulled(builder({ name: nameOf(spec.id), spec }))
    await sandbox.stopWithTimeout(STOP_SECONDS * 1000).catch(() => sandbox.kill())
  },

  async start(id) {
    const handle = await Sandbox.get(nameOf(id))
    if (handle.status === 'running' && (await workloadJob(handle))) return
    const sandbox = await handle.connectOrStart({ detached: true })
    const { entrypoint, cmd, user } = handle.config().runtime as Workload
    await sandbox.execDetachedWith(entrypoint[0], (o) => o.args([...entrypoint.slice(1), ...cmd]).user(user).stdinNull())
    await sandbox.detach()
  },

  async stop({ id, seconds }) {
    const handle = await Sandbox.get(nameOf(id))
    if (RESTING.includes(handle.status)) return
    await handle.stopWithTimeout(seconds * 1000).catch(() => handle.killWithTimeout(KILL_MS))
  },

  async remove(id) {
    const handle = await find(id)
    if (!handle) return
    if (!RESTING.includes(handle.status)) await handle.killWithTimeout(KILL_MS)
    await handle.remove()
  },

  async exec({ id, command, stdin }) {
    const sandbox = await (await Sandbox.get(nameOf(id))).connect()
    const release = () => sandbox.detach().catch(() => undefined)
    const handle = await sandbox
      .execStreamWith(command[0], (o) => (stdin ? o.args(command.slice(1)).stdinPipe() : o.args(command.slice(1)).stdinNull()))
      .catch(async (e: unknown) => {
        await release()
        throw e
      })
    const { stdout, exit } = streamed(handle)
    return { stdin: stdin ? sinkOf(handle) : null, stdout, exit: exit.finally(release), kill: () => void handle.kill().catch(() => undefined) }
  },

  async run({ spec, command }) {
    const name = `run-${randomUUID()}`
    const sandbox = await builder({ name, spec: { ...spec, net: undefined } }).disableNetwork().create()
    try {
      const out = await sandbox.execWith(spec.entrypoint, (o) => o.args(command).stdinNull())
      return { code: out.code, stdout: out.stdout() }
    } finally {
      await sandbox.killWithTimeout(KILL_MS).catch(() => undefined)
      await Sandbox.remove(name).catch(() => undefined)
    }
  },

  async list() {
    const states: SandboxState[] = []
    let cursor: string | undefined
    do {
      const page = await Sandbox.listWith((l) => (cursor ? l.cursor(cursor) : l))
      for (const handle of page.sandboxes) {
        if (!handle.name.startsWith('ag-')) continue
        const job = handle.status === 'running' ? await workloadJob(handle).catch(() => undefined) : undefined
        const labels = (handle.config().labels ?? {}) as Record<string, string>
        states.push({ id: handle.name.slice(3), running: Boolean(job), startedAt: job?.startedAt ? new Date(job.startedAt).toISOString() : undefined, labels })
      }
      cursor = page.nextCursor
    } while (cursor)
    return states
  },

  async progress() {
    return pull
  },
}
