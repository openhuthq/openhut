import { existsSync } from 'node:fs'
import type { Duplex } from 'node:stream'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { BIN, box, conf, writeIfChanged } from './host.ts'
import type { Exec, Mount } from './sandbox/sandbox.ts'
import { isRecord, jsonOrUndefined } from './util.ts'

export const POLICY_FILE = 'browser-policy.json'
export const FREE_POLICY = `${JSON.stringify({ default: 'allow' })}\n`
export const HELD_POLICY = `${JSON.stringify({ default: 'deny', allow: ['snapshot', 'url', 'title', 'gettext', 'screenshot', 'tab_list', 'stream_status', 'wait'] })}\n`
export const HOLD_IDLE_MS = 120_000
export const MAX_FPS = 30

const AGENT_BROWSER = join(BIN, 'agent-browser')
const DIR = fileURLToPath(new URL('../../../../install/agent-browser', import.meta.url))

export const browser = {
  memoryMib: 4096,
  tmpMib: 1024,

  installed(): boolean {
    return box.name === 'memory' || existsSync(AGENT_BROWSER)
  },

  async prepare(): Promise<void> {
    if (!browser.installed()) throw new Error("agent-browser isn't installed on this server; run the installer again")
  },

  mounts(id: string): Mount[] {
    return [
      { host: AGENT_BROWSER, guest: '/usr/local/lib/agent-browser', readOnly: true },
      { host: DIR, guest: '/opt/agent-browser', readOnly: true },
      { host: `${DIR}/agent-browser.sh`, guest: '/usr/local/bin/agent-browser', readOnly: true },
      { host: `${conf(id)}/${POLICY_FILE}`, guest: `/opt/data/${POLICY_FILE}`, readOnly: true },
    ]
  },

  freeAll(ids: string[]): void {
    for (const id of ids) writeIfChanged(`${conf(id)}/${POLICY_FILE}`, FREE_POLICY)
  },

  async open({ sock, id, fps, rest, running }: { sock: Duplex; id: string; fps: number; rest: string; running: boolean }): Promise<undefined> {
    if (!running) {
      sock.end(`${JSON.stringify({ type: 'closed' })}\n`)
      return undefined
    }
    const bridge = await box.exec({ id, command: ['node', '/opt/agent-browser/bridge.mjs', 'live', String(fps)], stdin: true })
    const setHeld = (held: boolean) => {
      if (existsSync(conf(id))) writeIfChanged(`${conf(id)}/${POLICY_FILE}`, held ? HELD_POLICY : FREE_POLICY)
    }
    live({ id, sock, bridge, rest, setHeld })
    return undefined
  },
}

const PING_MS = 10_000
const MAX_UP_LINE = 2048
const PASSED = new Set(['frame', 'tabs', 'url', 'closed'])
const INPUT = new Set(['input_mouse', 'input_keyboard'])
const viewers = new Map<string, Set<Viewer>>()
const holds = new Map<string, Hold>()

export function live({ id, sock, bridge, rest, setHeld }: { id: string; sock: Duplex; bridge: Exec; rest: string; setHeld: (held: boolean) => void }): void {
  const viewer: Viewer = { say: (message) => sock.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`) }
  const others = viewers.get(id) ?? new Set()
  viewers.set(id, others.add(viewer))
  viewer.say(holdFor({ id, viewer }))
  const toBridge = (line: string) => bridge.stdin?.write(`${line}\n`)
  const ping = setInterval(() => toBridge('{"type":"ping"}'), PING_MS)
  createInterface({ input: bridge.stdout }).on('line', (line) => {
    const down = downLine(line)
    if (down) viewer.say(down)
  })
  let pending = ''
  const up = (chunk: string) => {
    pending += chunk
    for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
      const line = pending.slice(0, end)
      pending = pending.slice(end + 1)
      if (line.length > MAX_UP_LINE) return sock.destroy()
      const message = parse(line)
      if (message?.type === 'ack' && typeof message.seq === 'number') toBridge(JSON.stringify({ type: 'ack', seq: message.seq }))
      if (message?.type === 'hold') hold({ id, viewer, held: message.held === true, setHeld })
      if (typeof message?.type === 'string' && INPUT.has(message.type) && holds.get(id)?.viewer === viewer) {
        toBridge(JSON.stringify(message))
        idle({ id, setHeld })
      }
    }
    if (pending.length > MAX_UP_LINE) sock.destroy()
  }
  const leave = () => {
    clearInterval(ping)
    bridge.stdin?.end()
    others.delete(viewer)
    if (!others.size && viewers.get(id) === others) viewers.delete(id)
    if (holds.get(id)?.viewer === viewer) letGo({ id, setHeld })
  }
  bridge.stdin?.on('error', () => undefined)
  bridge.exit.then(() => sock.end(), () => sock.destroy())
  sock.setEncoding('utf8')
  sock.on('data', up)
  sock.on('end', () => sock.destroy())
  sock.on('close', leave)
  sock.on('error', () => sock.destroy())
  sock.resume()
  up(rest)
}

export function policyOf(id: string): string {
  return holds.has(id) ? HELD_POLICY : FREE_POLICY
}

export function downLine(line: string): string | undefined {
  const message = parse(line)
  if (typeof message?.type !== 'string') return undefined
  if (PASSED.has(message.type)) return line
  if (message.type === 'result') return JSON.stringify({ type: 'result', id: text(message.id, 64) })
  if (message.type !== 'command') return undefined
  const params = isRecord(message.params) ? message.params : {}
  return JSON.stringify({ type: 'command', id: text(message.id, 64), action: text(message.action, 40), url: text(params.url, 2048) })
}

function hold({ id, viewer, held, setHeld }: { id: string; viewer: Viewer; held: boolean; setHeld: (held: boolean) => void }): void {
  if (!held) {
    if (holds.get(id)?.viewer === viewer) letGo({ id, setHeld })
    return
  }
  clearTimeout(holds.get(id)?.timer)
  setHeld(true)
  holds.set(id, { viewer })
  idle({ id, setHeld })
  announce(id)
}

function idle({ id, setHeld }: { id: string; setHeld: (held: boolean) => void }): void {
  const known = holds.get(id)
  if (!known) return
  clearTimeout(known.timer)
  known.timer = setTimeout(() => letGo({ id, setHeld }), HOLD_IDLE_MS)
}

function letGo({ id, setHeld }: { id: string; setHeld: (held: boolean) => void }): void {
  clearTimeout(holds.get(id)?.timer)
  holds.delete(id)
  setHeld(false)
  announce(id)
}

function announce(id: string): void {
  for (const viewer of viewers.get(id) ?? []) viewer.say(holdFor({ id, viewer }))
}

function holdFor({ id, viewer }: { id: string; viewer: Viewer }) {
  return { type: 'hold', held: holds.has(id), mine: holds.get(id)?.viewer === viewer }
}

function parse(line: string): Record<string, unknown> | undefined {
  const value = jsonOrUndefined(line)
  return isRecord(value) ? value : undefined
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

type Viewer = { say: (message: string | object) => void }
type Hold = { viewer: Viewer; timer?: NodeJS.Timeout }
