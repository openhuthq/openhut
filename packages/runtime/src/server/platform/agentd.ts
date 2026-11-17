import { connect } from 'node:net'
import * as z from 'zod/mini'
import { config } from './config.ts'
import { HttpError } from './http-error.ts'

const TIMEOUT_MS = 180_000
const MAX_LIVE_LINE = 8 << 20
const Features = z.object({ whatsapp: z.boolean(), browser: z.boolean() })
const Failure = z.object({ ok: z.literal(false), error: z.string() })
const Pairing = z.object({ status: z.enum(['starting', 'qr', 'linked', 'error']), qr: z.optional(z.string()), phone: z.optional(z.string()), error: z.optional(z.string()) })

export const agentd = {
  health: () => ask({ request: { cmd: 'health' }, doing: 'check its health', schema: z.object({ firewall: z.boolean(), imageReady: z.optional(z.boolean()), updating: z.optional(z.boolean()), features: z.optional(Features) }) }),
  ps: () => ask({ request: { cmd: 'ps' }, doing: 'list the agents', schema: z.object({ states: z.record(z.string(), z.string()) }) }),
  create: ({ id, net, files, browser }: { id: string; net: number; files: AgentFiles; browser: boolean }) =>
    ask({ request: { cmd: 'create', id, net, files, browser }, doing: 'create the agent', schema: z.object({ container: z.string() }) }),
  apply: ({ id, net, files, browser, restart, force = false }: { id: string; net: number; files: AgentFiles; browser: boolean; restart: boolean; force?: boolean }) =>
    ask({ request: { cmd: 'apply', id, net, files, browser, restart, force }, doing: 'update the agent\'s files', schema: z.object({ applied: z.string(), restarted: z.boolean() }) }),
  browserStill: ({ id }: { id: string }) => ask({ request: { cmd: 'browser-still', id }, doing: 'read the browser', schema: z.object({ open: z.boolean(), url: z.string(), title: z.string(), data: z.string() }) }),
  holdBrowser: ({ id, held }: { id: string; held: boolean }) => ask({ request: { cmd: 'browser-hold', id, held }, doing: held ? 'pause the agent\'s browser' : 'hand the browser back', schema: z.object({ held: z.boolean() }) }),
  start: ({ id }: { id: string }) => ask({ request: { cmd: 'start', id }, doing: 'start the agent', schema: z.object({ started: z.string() }) }),
  stop: ({ id }: { id: string }) => ask({ request: { cmd: 'stop', id }, doing: 'stop the agent', schema: z.object({ stopped: z.string() }) }),
  remove: ({ id }: { id: string }) => ask({ request: { cmd: 'rm', id }, doing: 'delete the agent', schema: z.object({ removed: z.string() }) }),
  pairWhatsapp: ({ id }: { id: string }) => ask({ request: { cmd: 'wa-pair', id }, doing: 'link WhatsApp', schema: Pairing }),
  update: ({ appVersion }: { appVersion?: string }) => ask({ request: { cmd: 'update', appVersion }, doing: 'start the update', schema: z.object({ updating: z.boolean() }) }),
  skills: ({ id }: { id: string }) => ask({ request: { cmd: 'skills', id }, doing: 'list the skills', schema: z.object({ skills: z.array(z.object({ path: z.string(), head: z.string() })), bundled: z.string() }) }),
  readSkill: ({ id, path }: { id: string; path: string }) => ask({ request: { cmd: 'skill-read', id, path }, doing: 'open the skill', schema: z.object({ body: z.string() }) }),
  writeSkill: ({ id, path, body }: { id: string; path: string; body: string }) => ask({ request: { cmd: 'skill-write', id, path, body }, doing: 'save the skill', schema: z.object({ written: z.string() }) }),
  removeSkill: ({ id, path }: { id: string; path: string }) => ask({ request: { cmd: 'skill-rm', id, path }, doing: 'delete the skill', schema: z.object({ removed: z.string() }) }),
  memory: ({ id }: { id: string }) => ask({ request: { cmd: 'memory', id }, doing: 'read the memory', schema: z.object({ notes: z.nullable(z.string()), people: z.nullable(z.string()) }) }),
  writeMemory: ({ id, target, body }: { id: string; target: 'notes' | 'people'; body: string }) => ask({ request: { cmd: 'memory-write', id, target, body }, doing: 'save the memory', schema: z.object({ written: z.string() }) }),
  exportHome: ({ id }: { id: string }) => ask({ request: { cmd: 'home-export', id }, doing: 'pack the agent\'s home', schema: z.object({ tar: z.string() }) }),
  importHome: ({ id, tar }: { id: string; tar: string }) => ask({ request: { cmd: 'home-import', id }, body: tar, doing: 'unpack the agent\'s home', schema: z.object({ imported: z.string() }) }),
  newMessages: ({ since }: { since: number }) => ask({ request: { cmd: 'messages', since }, doing: 'look for new messages', schema: z.object({ messages: z.array(z.object({ agentId: z.string(), source: z.string(), at: z.number() })) }) }),
  usage: ({ since }: { since: number }) => ask({ request: { cmd: 'usage', since }, doing: 'read the agents\' usage', schema: z.object({ usage: z.record(z.string(), z.number()) }) }),
  unlinkWhatsapp: ({ id }: { id: string }) => ask({ request: { cmd: 'wa-unlink', id }, doing: 'unlink WhatsApp', schema: z.object({ unlinked: z.string() }) }),
}

export function liveBrowser({ id, onLine, onEnd }: { id: string; onLine: (line: string) => void; onEnd: () => void }): LiveBrowser {
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
  socket.on('error', () => socket.destroy())
  socket.on('close', onEnd)
  socket.write(`${JSON.stringify({ cmd: 'browser-live', id })}\n`)
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
  if (failure.success) throw new HttpError(502, `The agent runner couldn't ${doing}: ${failure.data.error}. Details are in /var/log/openhut/agentd.log.`)
  const parsed = z.safeParse(schema, reply)
  if (!parsed.success) throw new HttpError(502, `The agent runner sent a reply the app doesn't understand while trying to ${doing}. Check that agentd and the app are the same release.`)
  return parsed.data
}

function send({ request, body = '', doing }: { request: Record<string, unknown>; body?: string; doing: string }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(config.agentdSocket)
    let buffer = ''
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy()
      reject(new HttpError(504, `The agent runner didn't ${doing} in time. Try again.`))
    })
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { buffer += chunk })
    socket.on('end', () => {
      try { resolve(JSON.parse(buffer)) } catch { reject(new HttpError(502, `The agent runner sent a broken reply while trying to ${doing}. Try again.`)) }
    })
    socket.on('error', (err) => reject(new HttpError(503, `The agent runner isn't reachable (${err.message}). Check that agentd is running.`)))
    socket.end(`${JSON.stringify(request)}\n${body}`)
  })
}

export type AgentFiles = Record<'config.yaml' | '.env' | 'SOUL.md' | 'auth.json', string>
export type LiveBrowser = { send: (line: string) => void; close: () => void }
