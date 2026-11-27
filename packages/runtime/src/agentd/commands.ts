import type { Duplex } from 'node:stream'
import { agents, FILES, RESTART_KEY, type AgentFiles } from './agents.ts'
import { browser, MAX_FPS } from './browser.ts'
import { newMessages, usage } from './hermes-db.ts'
import { agentHome, type Kind } from './home/home.ts'
import { MAX_FILE_BASE64 } from './home/uploads.ts'
import { config } from './config.ts'
import { box, home, scratchSpec } from './host.ts'
import { fenceLines, proveFence, type FenceReport } from './network/fence.ts'
import { firewall } from './network/firewall.ts'
import { ID, RESOLV } from './network/ports.ts'
import { isRecord } from './util.ts'
import { whatsapp } from './whatsapp.ts'

const MAX_FILE = 200_000
const MAX_LISTED = 200
const READABLE: Kind[] = ['skill', 'memory', 'file', 'upload']
const WRITABLE: Kind[] = ['skill', 'memory', 'upload']
const REMOVABLE: Kind[] = ['upload', 'skill-folder', 'session']

let fence: Promise<FenceReport> | undefined

export const commands = {
  health: {
    parse: () => ({}),
    run: async () => ({
      firewall: await firewall.recent(), image: config.image, ...await box.health(config.image),
      features: { whatsapp: whatsapp.installed(), browser: browser.installed() },
    }),
  },
  ps: {
    parse: () => ({}),
    run: async () => ({ states: await agents.states() }),
  },
  progress: {
    parse: () => ({}),
    run: async () => ({ pull: await box.progress() }),
  },
  fence: {
    parse: () => ({}),
    run: async (): Promise<FenceReport> => fence && (await fence).ok ? fence : checkFence(),
  },
  apply: {
    parse: (v: Fields) => ({ id: agentId(v.id), net: netOf(v.net), files: filesOf(v.files), browser: v.browser === true, running: v.running === true, force: v.force === true, restart: v.restart !== false }),
    run: agents.apply,
  },
  stop: {
    parse: (v: Fields) => ({ id: agentId(v.id) }),
    run: ({ id }: { id: string }) => agents.stop(id),
  },
  rm: {
    parse: (v: Fields) => ({ id: agentId(v.id), trash: v.trash === true }),
    run: ({ id, trash }: { id: string; trash: boolean }) => agents.remove(id, trash),
  },
  skills: {
    parse: (v: Fields) => ({ id: agentId(v.id) }),
    run: async ({ id }: { id: string }) => agentHome.skills(id),
  },
  read: {
    parse: (v: Fields) => ({ id: agentId(v.id), path: pathOf({ value: v.path, kinds: READABLE }) }),
    run: async ({ id, path }: { id: string; path: string }) => ({ body: agentHome.read({ id, path })?.toString('base64') ?? null }),
  },
  write: {
    body: MAX_FILE_BASE64,
    parse: (v: Fields) => ({ id: agentId(v.id), path: pathOf({ value: v.path, kinds: WRITABLE }), create: v.create === true, replace: v.replace === true }),
    run: async ({ id, path, body, create, replace }: { id: string; path: string; body: string; create: boolean; replace: boolean }) => ({ path: agentHome.write({ id, path, create, replace, body: Buffer.from(body, 'base64') }) }),
  },
  delete: {
    parse: (v: Fields) => ({ id: agentId(v.id), paths: pathsOf({ value: v.paths, kinds: REMOVABLE }) }),
    run: async ({ id, paths }: { id: string; paths: string[] }) => {
      const uploads = paths.filter((path) => agentHome.kindOf(path) === 'upload')
      const removed = uploads.length ? agentHome.removeUploads({ id, paths: uploads }) : []
      for (const guest of paths.filter((path) => !uploads.includes(path))) await agents.removeInside({ id, guest })
      return { removed: [...removed, ...paths.filter((path) => !uploads.includes(path))] }
    },
  },
  stat: {
    parse: (v: Fields) => ({ id: agentId(v.id), paths: pathsOf({ value: v.paths, kinds: ['file', 'upload'] }) }),
    run: async ({ id, paths }: { id: string; paths: string[] }) => ({ files: agentHome.stat({ id, paths }) }),
  },
  usage: {
    parse: (v: Fields) => ({ since: sinceOf(v.since) }),
    run: async ({ since }: { since: number }) => ({ usage: usage({ agents: stateDbs(), since }) }),
  },
  messages: {
    parse: (v: Fields) => ({ since: sinceOf(v.since) }),
    run: async ({ since }: { since: number }) => ({ messages: newMessages({ agents: stateDbs(), since }) }),
  },
  'browser-live': {
    stream: true,
    parse: (v: Fields) => ({ id: agentId(v.id), fps: Number.isInteger(v.fps) && Number(v.fps) >= 1 ? Math.min(Number(v.fps), MAX_FPS) : MAX_FPS }),
    run: async ({ id, fps }: { id: string; fps: number }, { sock, rest }: Stream) => browser.open({ sock, id, fps, rest, running: await agents.isRunning(id) }),
  },
  'wa-pair': {
    stream: true,
    parse: (v: Fields) => ({ id: agentId(v.id) }),
    run: async ({ id }: { id: string }, { sock, queue }: Stream) => whatsapp.pair({
      id, sock, running: await agents.isRunning(id),
      ended: () => queue(async () => {
        if (await agents.isRunning(id)) await agents.restart(id)
      }).catch((e: unknown) => console.error(`wa-pair: restart ${id}: ${e instanceof Error ? e.message : String(e)}`)),
    }),
  },
} satisfies Record<string, Command>

function agentId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error('bad agent id')
  return value
}

function netOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 250) throw new Error('bad net')
  return value
}

function sinceOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('bad since')
  return value
}

function filesOf(value: unknown): AgentFiles {
  if (!isRecord(value)) throw new Error('missing files')
  const files: Partial<AgentFiles> = {}
  for (const name of FILES) {
    const body = value[name]
    if (typeof body !== 'string' || body.length > MAX_FILE) throw new Error(`missing or oversized ${name}`)
    files[name] = body
  }
  if (typeof value[RESTART_KEY] === 'string') files[RESTART_KEY] = value[RESTART_KEY].slice(0, 200)
  return files as AgentFiles
}

function pathOf({ value, kinds }: { value: unknown; kinds: Kind[] }): string {
  const kind = agentHome.kindOf(value)
  if (typeof value !== 'string' || !kind || !kinds.includes(kind)) throw new Error('bad path')
  return value
}

function pathsOf({ value, kinds }: { value: unknown; kinds: Kind[] }): string[] {
  if (!Array.isArray(value) || value.length > MAX_LISTED) throw new Error('bad paths')
  return value.map((each) => pathOf({ value: each, kinds }))
}

function stateDbs() {
  return agents.ids().map((id) => ({ id, file: `${home(id)}/state.db` }))
}

export function checkFence(): Promise<FenceReport> {
  const spec = scratchSpec({ id: 'fence', mounts: [{ host: RESOLV, guest: '/etc/resolv.conf', readOnly: true }], tmpfs: [{ guest: '/tmp', sizeMib: 16 }] })
  fence = proveFence({ box, spec }).then((report) => {
    for (const line of fenceLines(report)) (report.ok ? console.log : console.error)(line)
    return report
  })
  return fence
}

type Fields = Record<string, unknown>
export type Stream = { sock: Duplex; rest: string; queue: (work: () => Promise<unknown>) => Promise<unknown> }
export type Command = {
  parse: (value: Fields) => Record<string, unknown>
  run: (request: never, stream: Stream) => Promise<object | undefined>
  body?: number
  stream?: true
}
