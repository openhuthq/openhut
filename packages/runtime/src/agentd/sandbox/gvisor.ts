import { execFile, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { EXEC, errorText, isRecord } from '../util.ts'
import type { Exec, Mount, Pull, Sandboxes, SandboxSpec, SandboxState } from './sandbox.ts'

const exec = promisify(execFile)
const PULL_LOG = '/var/log/openhut/pull.log'
export const FIREWALL = fileURLToPath(new URL('../../../../../install/agents-firewall.sh', import.meta.url))

export const gvisor: Sandboxes = {
  name: 'gvisor',

  async ready() {
    return exec(FIREWALL, ['--check'], EXEC).then(() => ({ ok: true }), () => ({ ok: false, reason: 'firewall is off' }))
  },

  async create(spec) {
    if (spec.net === undefined) throw new Error('a gVisor sandbox needs its network number')
    const name = `ag-${spec.id}`
    await docker('rm', '-f', name).catch(ignoreMissing)
    await freshNetwork({ id: spec.id, net: spec.net })
    await docker(...createArgs({ ...spec, image: await digestOf(spec.image) }))
  },

  async start(id) {
    await docker('start', `ag-${id}`)
  },

  async stop({ id, seconds }) {
    await docker('stop', '-t', String(seconds), `ag-${id}`)
  },

  async remove(id) {
    await docker('rm', '-f', `ag-${id}`).catch(ignoreMissing)
    await docker('network', 'rm', `ag-${id}`).catch(ignoreMissing)
  },

  async exec({ id, command, stdin = false }): Promise<Exec> {
    const proc = spawn('docker', ['exec', ...(stdin ? ['-i'] : []), `ag-${id}`, ...command], { stdio: ['pipe', 'pipe', 'ignore'] })
    if (!stdin) proc.stdin.end()
    const exit = new Promise<number>((resolve, reject) => {
      proc.on('error', reject)
      proc.on('close', (code) => resolve(code ?? -1))
    })
    exit.catch(() => undefined)
    return { stdin: stdin ? proc.stdin : null, stdout: proc.stdout, exit, kill: () => proc.kill() }
  },

  async run({ spec, command }) {
    const args = [
      'run', '--rm',
      ...['--runtime', 'runsc', '--user', spec.user, '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'],
      ...envArgs(spec.env), ...spec.mounts.flatMap(mountArgs), ...spec.tmpfs.flatMap(tmpfsArgs),
      ...['--entrypoint', spec.entrypoint],
      ...[await digestOf(spec.image), ...command],
    ]
    return exec('docker', args, EXEC).then(
      ({ stdout }) => ({ code: 0, stdout }),
      (e: unknown) => {
        if (!isRecord(e) || typeof e.code !== 'number') throw e
        return { code: e.code, stdout: typeof e.stdout === 'string' ? e.stdout : '' }
      },
    )
  },

  async list() {
    const ids = (await docker('ps', '-aq', '--no-trunc', '--filter', 'label=openhut.agent')).split('\n').filter(Boolean)
    if (!ids.length) return []
    const out = await exec('docker', ['inspect', ...ids], EXEC).then(({ stdout }) => stdout, (e: unknown) => {
      if (isRecord(e) && typeof e.stdout === 'string' && e.stdout.trim()) return e.stdout
      throw e
    })
    const rows: unknown = JSON.parse(out)
    return (Array.isArray(rows) ? rows : []).flatMap(stateOf)
  },

  async progress() {
    return pullOf(await readFile(PULL_LOG, 'utf8').catch(() => ''))
  },
}

export function createArgs(spec: SandboxSpec): string[] {
  const labels = { 'openhut.agent': spec.id, 'agent.digest': spec.image, ...spec.labels }
  return [
    'create',
    ...['--name', `ag-${spec.id}`, '--hostname', spec.id, '--restart', 'no'],
    ...Object.entries(labels).flatMap(([name, value]) => ['--label', `${name}=${value}`]),
    ...['--runtime', 'runsc', '--user', spec.user, '--init', '--entrypoint', spec.entrypoint],
    ...['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges'],
    ...['--pids-limit', '512', '--memory', sizeOf(spec.memoryMib), '--cpus', String(spec.cpus), '--log-opt', 'max-size=10m', '--log-opt', 'max-file=3'],
    ...['--network', `ag-${spec.id}`, '--ip', `10.200.${spec.net}.2`],
    ...envArgs(spec.env),
    ...spec.mounts.flatMap(mountArgs),
    ...spec.tmpfs.flatMap(tmpfsArgs),
    ...[spec.image, ...spec.command],
  ]
}

export function pullOf(log: string): Pull | null {
  const last = log.slice(log.lastIndexOf('Pulling from'))
  const total = last.match(/: Pulling fs layer/g)?.length ?? 0
  if (!log.includes('Pulling from') || !total || /Status: (Downloaded|Image is up to date)/.test(last)) return null
  return { done: last.match(/: Pull complete/g)?.length ?? 0, total, unit: 'layers' }
}

export async function imageReady(image: string): Promise<boolean> {
  return docker('image', 'inspect', image).then(() => true, () => false)
}

function envArgs(env: Record<string, string>) {
  return Object.entries(env).flatMap(([name, value]) => ['-e', `${name}=${value}`])
}

function mountArgs(mount: Mount) {
  return ['--mount', `type=bind,src=${mount.host},dst=${mount.guest}${mount.readOnly ? ',readonly' : ''}`]
}

function tmpfsArgs(tmpfs: SandboxSpec['tmpfs'][number]) {
  return ['--tmpfs', `${tmpfs.guest}:${tmpfs.readOnly ? 'ro' : 'rw,nosuid'},size=${sizeOf(tmpfs.sizeMib)}`]
}

function sizeOf(mib: number) {
  if (mib >= 1024 && mib % 1024 === 0) return `${mib / 1024}g`
  if (Number.isInteger(mib)) return `${mib}m`
  return `${Math.round(mib * 1024)}k`
}

function stateOf(row: unknown): SandboxState[] {
  const config = isRecord(row) ? row.Config : undefined
  const state = isRecord(row) ? row.State : undefined
  const raw = isRecord(config) && isRecord(config.Labels) ? config.Labels : {}
  const labels = Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  const id = labels['openhut.agent']
  if (!id || !isRecord(state)) return []
  const startedAt = typeof state.StartedAt === 'string' && !state.StartedAt.startsWith('0001-') ? state.StartedAt : undefined
  return [{ id, running: state.Running === true, startedAt, labels }]
}

async function freshNetwork({ id, net }: { id: string; net: number }) {
  await docker('network', 'rm', `ag-${id}`).catch(() => undefined)
  const create = () => docker('network', 'create', '--subnet', `10.200.${net}.0/24`, '--gateway', `10.200.${net}.1`, '--label', `openhut.agent=${id}`, `ag-${id}`)
  await create().catch(async (err: unknown) => {
    if (!/overlap/i.test(errorText(err))) throw err
    await dropUnused(`10.200.${net}.0/24`)
    return create()
  })
}

async function dropUnused(subnet: string) {
  for (const name of (await docker('network', 'ls', '--filter', 'name=ag-', '--format', '{{.Name}}')).split('\n').filter(Boolean)) {
    const used = await docker('network', 'inspect', '--format', '{{range .IPAM.Config}}{{.Subnet}}{{end}}', name).catch(() => '')
    if (used === subnet) await docker('network', 'rm', name).catch(() => undefined)
  }
}

async function digestOf(image: string) {
  return docker('image', 'inspect', '--format', '{{index .RepoDigests 0}}', image).catch(() => image)
}

async function docker(...args: string[]) {
  return (await exec('docker', args, EXEC)).stdout.trim()
}

function ignoreMissing(e: unknown) {
  if (!/No such (container|network)|not found/i.test(errorText(e))) throw e
  return ''
}
