import type { Duplex } from 'node:stream'
import * as z from 'zod/mini'
import { log } from './events.ts'
import { HttpError } from './http-error.ts'
import { forward } from '../relay/forward.ts'
import { HERE } from '../team/home.ts'

const TIMEOUT_MS = 180_000
const MAX_LIVE_LINE = 8 << 20
const Features = z.object({ whatsapp: z.boolean(), browser: z.boolean() })
const Failure = z.object({ ok: z.literal(false), error: z.string() })
const Change = z.enum(['created', 'started', 'restarted', 'stopped', 'none'])
type On = { on?: string }

export const agentd = {
  health: ({ on = HERE }: On = {}) => ask({ on, request: { cmd: 'health' }, doing: 'check its health', schema: z.object({ firewall: z.boolean(), imageReady: z.optional(z.boolean()), gvisor: z.optional(z.boolean()), features: z.optional(Features) }) }),
  ps: ({ on = HERE }: On = {}) => ask({ on, request: { cmd: 'ps' }, doing: 'list the agents', schema: z.object({ states: z.record(z.string(), z.string()) }) }),
  apply: ({ id, net, files, browser, running, force = false, on }: { id: string; net: number; files: AgentFiles; browser: boolean; running: boolean; force?: boolean } & On) =>
    ask({ on, request: { cmd: 'apply', id, net, files, browser, running, force }, doing: 'set up the agent', schema: z.object({ applied: z.string(), change: Change }) }),
  stop: ({ id, on }: { id: string } & On) => ask({ on, request: { cmd: 'stop', id }, doing: 'stop the agent', schema: z.object({ stopped: z.string() }) }),
  remove: ({ id, trash = false, on }: { id: string; trash?: boolean } & On) => ask({ on, request: { cmd: 'rm', id, trash }, doing: 'delete the agent', schema: z.object({ removed: z.string() }) }),
  skills: ({ id }: { id: string }) => ask({ request: { cmd: 'skills', id }, doing: 'list the skills', schema: z.object({ skills: z.array(z.object({ path: z.string(), head: z.string() })), bundled: z.string() }) }),
  read: async ({ id, path }: { id: string; path: string }): Promise<Buffer | null> => {
    const { body } = await ask({ request: { cmd: 'read', id, path }, doing: 'read the file', schema: z.object({ body: z.nullable(z.string()) }) })
    return body === null ? null : Buffer.from(body, 'base64')
  },
  write: ({ id, path, body, create, replace }: { id: string; path: string; body: Buffer | string; create?: boolean; replace?: boolean }) =>
    ask({ request: { cmd: 'write', id, path, create, replace }, body: Buffer.from(body).toString('base64'), doing: 'save the file in the agent\'s home', schema: z.object({ path: z.string() }) }),
  delete: ({ id, paths }: { id: string; paths: string[] }) => ask({ request: { cmd: 'delete', id, paths }, doing: 'delete the files', schema: z.object({ removed: z.array(z.string()) }) }),
  stat: ({ id, paths }: { id: string; paths: string[] }) => ask({ request: { cmd: 'stat', id, paths }, doing: 'look for the files', schema: z.object({ files: z.array(z.object({ path: z.string(), size: z.number() })) }) }),
  usage: async ({ since }: { since: number }) => {
    const replies = await everywhere((on) => ask({ on, request: { cmd: 'usage', since }, doing: 'read the agents\' usage', schema: z.object({ usage: z.record(z.string(), z.number()) }) }))
    return { usage: Object.assign({}, ...replies.map((reply) => reply.usage)) as Record<string, number> }
  },
}

export function liveBrowser({ id, fps, onLine, onEnd }: { id: string; fps: number; onLine: (line: string) => void; onEnd: () => void }): Stream {
  return stream({ id, request: { cmd: 'browser-live', id, fps }, onLine, onEnd })
}

export function pairWhatsapp({ id, onLine, onEnd }: { id: string; onLine: (line: string) => void; onEnd: () => void }): Stream {
  return stream({ id, request: { cmd: 'wa-pair', id }, onLine, onEnd })
}

function stream({ id, request, onLine, onEnd }: { id: string; request: Record<string, unknown>; onLine: (line: string) => void; onEnd: () => void }): Stream {
  let socket: Duplex | undefined
  let closed = false
  let pending = ''
  forward.computerOf(id).then((on) => {
    socket = forward.open({ on, request: { to: 'agentd' } })
    if (closed) return socket.destroy()
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => {
      pending += chunk
      for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
        onLine(pending.slice(0, end))
        pending = pending.slice(end + 1)
      }
      if (pending.length > MAX_LIVE_LINE) socket?.destroy()
    })
    socket.on('end', () => {
      if (pending) onLine(pending)
      pending = ''
      socket?.destroy()
    })
    socket.on('error', () => socket?.destroy())
    socket.on('close', onEnd)
    socket.write(`${JSON.stringify(request)}\n`)
  }).catch(() => onEnd())
  return { send: (line) => socket?.write(`${line}\n`), close: () => { closed = true; socket?.destroy() } }
}

export async function features({ on = HERE }: On = {}): Promise<z.output<typeof Features>> {
  return (await agentd.health({ on }).catch(() => undefined))?.features ?? { whatsapp: false, browser: false }
}

export async function containerStates(): Promise<Record<string, string> | undefined> {
  const replies = await everywhere((on) => agentd.ps({ on }))
  return replies.length ? Object.assign({}, ...replies.map((reply) => reply.states)) as Record<string, string> : undefined
}

async function everywhere<T>(each: (on: string) => Promise<T>): Promise<T[]> {
  const settled = await Promise.allSettled(forward.computers().map(each))
  return settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
}

async function ask<S extends z.ZodMiniType>({ on, request, body, doing, schema }: { on?: string; request: Record<string, unknown>; body?: string; doing: string; schema: S }): Promise<z.output<S>> {
  const computer = on ?? await forward.computerOf(typeof request.id === 'string' ? request.id : undefined)
  const reply = await send({ on: computer, request, body, doing })
  const failure = z.safeParse(Failure, reply)
  if (failure.success) throw new HttpError(502, `OpenHut couldn't ${doing}: ${failure.data.error}. Restart OpenHut and try again.`)
  const parsed = z.safeParse(schema, reply)
  if (!parsed.success) throw new HttpError(502, `OpenHut couldn't ${doing}. Update OpenHut on this computer and try again.`)
  return parsed.data
}

function send({ on, request, body = '', doing }: { on: string; request: Record<string, unknown>; body?: string; doing: string }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = forward.open({ on, request: { to: 'agentd' } })
    let buffer = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new HttpError(504, `OpenHut didn't ${doing} in time. Try again.`))
    }, TIMEOUT_MS)
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { buffer += chunk })
    socket.on('end', () => {
      clearTimeout(timer)
      socket.destroy()
      try { resolve(JSON.parse(buffer)) } catch { reject(new HttpError(502, `OpenHut couldn't ${doing}. Try again.`)) }
    })
    socket.on('error', (err) => {
      clearTimeout(timer)
      log.error({ event: 'agentd.unreachable', error: err.message })
      reject(new HttpError(503, 'Agents can\'t run on this computer right now. Restart OpenHut on it.'))
    })
    socket.on('close', () => {
      clearTimeout(timer)
      reject(new HttpError(503, 'The computer that runs this agent went offline. Try again when it\'s back.'))
    })
    socket.write(`${JSON.stringify(request)}\n${body && `${body}\n`}`)
  })
}

export type AgentFiles = Record<'config.yaml' | '.env' | 'SOUL.md' | 'auth.json', string>
export type Stream = { send: (line: string) => void; close: () => void }
