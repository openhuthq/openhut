import { connect } from 'node:net'
import * as z from 'zod/mini'
import { config } from './config.ts'
import { log } from './events.ts'
import { HttpError } from './http-error.ts'

const TIMEOUT_MS = 180_000
const MAX_LIVE_LINE = 8 << 20
const Features = z.object({ whatsapp: z.boolean(), browser: z.boolean() })
export const LastUpdate = z.object({ exit: z.number(), at: z.string(), reason: z.nullable(z.string()) })
export type LastUpdate = z.infer<typeof LastUpdate>
const Failure = z.object({ ok: z.literal(false), error: z.string() })
const Change = z.enum(['created', 'started', 'restarted', 'stopped', 'none'])

export const agentd = {
  health: () => ask({ request: { cmd: 'health' }, doing: 'check its health', schema: z.object({ firewall: z.boolean(), imageReady: z.optional(z.boolean()), updating: z.optional(z.boolean()), lastUpdate: z.optional(z.nullable(LastUpdate)), features: z.optional(Features) }) }),
  ps: () => ask({ request: { cmd: 'ps' }, doing: 'list the agents', schema: z.object({ states: z.record(z.string(), z.string()) }) }),
  apply: ({ id, net, files, browser, running, force = false }: { id: string; net: number; files: AgentFiles; browser: boolean; running: boolean; force?: boolean }) =>
    ask({ request: { cmd: 'apply', id, net, files, browser, running, force }, doing: 'set up the agent', schema: z.object({ applied: z.string(), change: Change }) }),
  stop: ({ id }: { id: string }) => ask({ request: { cmd: 'stop', id }, doing: 'stop the agent', schema: z.object({ stopped: z.string() }) }),
  remove: ({ id, trash = false }: { id: string; trash?: boolean }) => ask({ request: { cmd: 'rm', id, trash }, doing: 'delete the agent', schema: z.object({ removed: z.string() }) }),
  update: ({ appVersion, sha256 }: { appVersion?: string; sha256: string }) => ask({ request: { cmd: 'update', appVersion, sha256 }, doing: 'start the update', schema: z.object({ updating: z.boolean() }) }),
  skills: ({ id }: { id: string }) => ask({ request: { cmd: 'skills', id }, doing: 'list the skills', schema: z.object({ skills: z.array(z.object({ path: z.string(), head: z.string() })), bundled: z.string() }) }),
  read: async ({ id, path }: { id: string; path: string }): Promise<Buffer | null> => {
    const { body } = await ask({ request: { cmd: 'read', id, path }, doing: 'read the file', schema: z.object({ body: z.nullable(z.string()) }) })
    return body === null ? null : Buffer.from(body, 'base64')
  },
  write: ({ id, path, body, create, replace }: { id: string; path: string; body: Buffer | string; create?: boolean; replace?: boolean }) =>
    ask({ request: { cmd: 'write', id, path, create, replace }, body: Buffer.from(body).toString('base64'), doing: 'save the file in the agent\'s home', schema: z.object({ path: z.string() }) }),
  delete: ({ id, paths }: { id: string; paths: string[] }) => ask({ request: { cmd: 'delete', id, paths }, doing: 'delete the files', schema: z.object({ removed: z.array(z.string()) }) }),
  stat: ({ id, paths }: { id: string; paths: string[] }) => ask({ request: { cmd: 'stat', id, paths }, doing: 'look for the files', schema: z.object({ files: z.array(z.object({ path: z.string(), size: z.number() })) }) }),
  exportHome: ({ id }: { id: string }) => ask({ request: { cmd: 'home-export', id }, doing: 'pack the agent\'s home', schema: z.object({ tar: z.string() }) }),
  importHome: ({ id, tar }: { id: string; tar: string }) => ask({ request: { cmd: 'home-import', id }, body: tar, doing: 'unpack the agent\'s home', schema: z.object({ imported: z.string() }) }),
  newMessages: ({ since }: { since: number }) => ask({ request: { cmd: 'messages', since }, doing: 'look for new messages', schema: z.object({ messages: z.array(z.object({ agentId: z.string(), source: z.string(), at: z.number() })) }) }),
  usage: ({ since }: { since: number }) => ask({ request: { cmd: 'usage', since }, doing: 'read the agents\' usage', schema: z.object({ usage: z.record(z.string(), z.number()) }) }),
}

export function liveBrowser({ id, fps, onLine, onEnd }: { id: string; fps: number; onLine: (line: string) => void; onEnd: () => void }): Stream {
  return stream({ request: { cmd: 'browser-live', id, fps }, onLine, onEnd })
}

export function pairWhatsapp({ id, onLine, onEnd }: { id: string; onLine: (line: string) => void; onEnd: () => void }): Stream {
  return stream({ request: { cmd: 'wa-pair', id }, onLine, onEnd })
}

function stream({ request, onLine, onEnd }: { request: Record<string, unknown>; onLine: (line: string) => void; onEnd: () => void }): Stream {
  const socket = connect(config.agentdSocket)
  let pending = ''
  socket.setEncoding('utf8')
  socket.on('data', (chunk: string) => {
    pending += chunk
    for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
      onLine(pending.slice(0, end))
      pending = pending.slice(end + 1)
    }
    if (pending.length > MAX_LIVE_LINE) socket.destroy()
  })
  socket.on('end', () => {
    if (pending) onLine(pending)
    pending = ''
  })
  socket.on('error', () => socket.destroy())
  socket.on('close', onEnd)
  socket.write(`${JSON.stringify(request)}\n`)
  return { send: (line) => socket.write(`${line}\n`), close: () => socket.destroy() }
}

export async function features(): Promise<z.output<typeof Features>> {
  return (await agentd.health().catch(() => undefined))?.features ?? { whatsapp: false, browser: false }
}

export async function containerStates(): Promise<Record<string, string> | undefined> {
  const reply = await agentd.ps().catch(() => undefined)
  return reply?.states
}

async function ask<S extends z.ZodMiniType>({ request, body, doing, schema }: { request: Record<string, unknown>; body?: string; doing: string; schema: S }): Promise<z.output<S>> {
  const reply = await send({ request, body, doing })
  const failure = z.safeParse(Failure, reply)
  if (failure.success) throw new HttpError(502, `OpenHut couldn't ${doing}: ${failure.data.error}. Restart OpenHut and try again.`)
  const parsed = z.safeParse(schema, reply)
  if (!parsed.success) throw new HttpError(502, `OpenHut couldn't ${doing}. Update OpenHut on this computer and try again.`)
  return parsed.data
}

function send({ request, body = '', doing }: { request: Record<string, unknown>; body?: string; doing: string }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(config.agentdSocket)
    let buffer = ''
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy()
      reject(new HttpError(504, `OpenHut didn't ${doing} in time. Try again.`))
    })
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { buffer += chunk })
    socket.on('end', () => {
      try { resolve(JSON.parse(buffer)) } catch { reject(new HttpError(502, `OpenHut couldn't ${doing}. Try again.`)) }
    })
    socket.on('error', (err) => {
      log.error({ event: 'agentd.unreachable', error: err.message })
      reject(new HttpError(503, 'Agents can\'t run on this computer right now. Restart OpenHut on it.'))
    })
    socket.write(`${JSON.stringify(request)}\n${body && `${body}\n`}`)
  })
}

export type AgentFiles = Record<'config.yaml' | '.env' | 'SOUL.md' | 'auth.json', string>
export type Stream = { send: (line: string) => void; close: () => void }
