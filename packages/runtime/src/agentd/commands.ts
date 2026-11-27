import type { Duplex } from 'node:stream'
import { hermesBox as runtime, type Kind } from './adapters/hermes/index.ts'
import { agents } from './agents.ts'
import { browser, MAX_FPS } from './browser.ts'
import { config } from './config.ts'
import { MAX_FILE_BASE64 } from './home/uploads.ts'
import { box, scratchSpec } from './host.ts'
import { fenceLines, proveFence, type FenceReport } from './network/fence.ts'
import { firewall } from './network/firewall.ts'
import { ID, RESOLV } from './network/ports.ts'

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
      features: { whatsapp: runtime.whatsapp.installed(), browser: browser.installed() },
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
    parse: (v: Fields) => ({ id: agentId(v.id), net: netOf(v.net), files: runtime.validateFiles(v.files), browser: v.browser === true, running: v.running === true, force: v.force === true, restart: v.restart !== false }),
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
    run: async ({ id }: { id: string }) => runtime.home.skills(id),
  },
  read: {
    parse: (v: Fields) => ({ id: agentId(v.id), path: pathOf({ value: v.path, kinds: READABLE }) }),
    run: async ({ id, path }: { id: string; path: string }) => ({ body: runtime.home.read({ id, path })?.toString('base64') ?? null }),
  },
  write: {
    body: MAX_FILE_BASE64,
    parse: (v: Fields) => ({ id: agentId(v.id), path: pathOf({ value: v.path, kinds: WRITABLE }), create: v.create === true, replace: v.replace === true }),
    run: async ({ id, path, body, create, replace }: { id: string; path: string; body: string; create: boolean; replace: boolean }) => ({ path: runtime.home.write({ id, path, create, replace, body: Buffer.from(body, 'base64') }) }),
  },
  delete: {
    parse: (v: Fields) => ({ id: agentId(v.id), paths: pathsOf({ value: v.paths, kinds: REMOVABLE }) }),
    run: async ({ id, paths }: { id: string; paths: string[] }) => {
      const uploads = paths.filter((path) => runtime.home.kindOf(path) === 'upload')
      const removed = uploads.length ? runtime.home.removeUploads({ id, paths: uploads }) : []
      for (const guest of paths.filter((path) => !uploads.includes(path))) await agents.removeInside({ id, guest })
      return { removed: [...removed, ...paths.filter((path) => !uploads.includes(path))] }
    },
  },
  stat: {
    parse: (v: Fields) => ({ id: agentId(v.id), paths: pathsOf({ value: v.paths, kinds: ['file', 'upload'] }) }),
    run: async ({ id, paths }: { id: string; paths: string[] }) => ({ files: runtime.home.stat({ id, paths }) }),
  },
  usage: {
    parse: (v: Fields) => ({ since: sinceOf(v.since) }),
    run: async ({ since }: { since: number }) => ({ usage: runtime.usage(since) }),
  },
  messages: {
    parse: (v: Fields) => ({ since: sinceOf(v.since) }),
    run: async ({ since }: { since: number }) => ({ messages: runtime.messages(since) }),
  },
  'browser-live': {
    stream: true,
    parse: (v: Fields) => ({ id: agentId(v.id), fps: Number.isInteger(v.fps) && Number(v.fps) >= 1 ? Math.min(Number(v.fps), MAX_FPS) : MAX_FPS }),
    run: async ({ id, fps }: { id: string; fps: number }, { sock, rest }: Stream) => browser.open({ sock, id, fps, rest, running: await agents.isRunning(id) }),
  },
  'wa-pair': {
    stream: true,
    parse: (v: Fields) => ({ id: agentId(v.id) }),
    run: async ({ id }: { id: string }, { sock, queue }: Stream) => runtime.whatsapp.pair({
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

function pathOf({ value, kinds }: { value: unknown; kinds: Kind[] }): string {
  const kind = runtime.home.kindOf(value)
  if (typeof value !== 'string' || !kind || !kinds.includes(kind)) throw new Error('bad path')
  return value
}

function pathsOf({ value, kinds }: { value: unknown; kinds: Kind[] }): string[] {
  if (!Array.isArray(value) || value.length > MAX_LISTED) throw new Error('bad paths')
  return value.map((each) => pathOf({ value: each, kinds }))
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
