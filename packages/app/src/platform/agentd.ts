import { connect } from 'node:net'
import * as z from 'zod/mini'
import type { AgentSize } from '@fastmonkey/common/agents/agent.ts'
import { config } from './config.ts'
import { HttpError } from './http-error.ts'

const TIMEOUT_MS = 180_000
const Failure = z.object({ ok: z.literal(false), error: z.string() })
const Tailnet = z.object({ state: z.string(), tailnet: z.string(), name: z.string(), address: z.string() })
const Pairing = z.object({ status: z.enum(['starting', 'qr', 'linked', 'error']), qr: z.optional(z.string()), phone: z.optional(z.string()), error: z.optional(z.string()) })

export const agentd = {
  health: () => ask({ request: { cmd: 'health' }, doing: 'check its health', schema: z.object({ firewall: z.boolean(), updating: z.optional(z.boolean()) }) }),
  containers: () => ask({ request: { cmd: 'containers' }, doing: 'list the containers', schema: z.object({ containers: z.array(z.object({ name: z.string(), agentId: z.string(), state: z.string(), status: z.string(), image: z.string(), createdAt: z.string(), networks: z.string() })) }) }),
  ps: () => ask({ request: { cmd: 'ps' }, doing: 'list the agents', schema: z.object({ states: z.record(z.string(), z.string()) }) }),
  create: ({ id, net, files, size }: { id: string; net: number; files: AgentFiles; size: AgentSize }) =>
    ask({ request: { cmd: 'create', id, net, files, size }, doing: 'create the agent', schema: z.object({ container: z.string() }) }),
  apply: ({ id, net, files, size, restart, force = false }: { id: string; net: number; files: AgentFiles; size: AgentSize; restart: boolean; force?: boolean }) =>
    ask({ request: { cmd: 'apply', id, net, files, size, restart, force }, doing: 'update the agent\'s files', schema: z.object({ applied: z.string(), restarted: z.boolean() }) }),
  start: ({ id }: { id: string }) => ask({ request: { cmd: 'start', id }, doing: 'start the agent', schema: z.object({ started: z.string() }) }),
  stop: ({ id }: { id: string }) => ask({ request: { cmd: 'stop', id }, doing: 'stop the agent', schema: z.object({ stopped: z.string() }) }),
  remove: ({ id }: { id: string }) => ask({ request: { cmd: 'rm', id }, doing: 'delete the agent', schema: z.object({ removed: z.string() }) }),
  pairWhatsapp: ({ id }: { id: string }) => ask({ request: { cmd: 'wa-pair', id }, doing: 'link WhatsApp', schema: Pairing }),
  update: () => ask({ request: { cmd: 'update' }, doing: 'start the update', schema: z.object({ updating: z.boolean() }) }),
  skills: ({ id }: { id: string }) => ask({ request: { cmd: 'skills', id }, doing: 'list the skills', schema: z.object({ skills: z.array(z.object({ path: z.string(), head: z.string() })), bundled: z.string() }) }),
  readSkill: ({ id, path }: { id: string; path: string }) => ask({ request: { cmd: 'skill-read', id, path }, doing: 'open the skill', schema: z.object({ body: z.string() }) }),
  writeSkill: ({ id, path, body }: { id: string; path: string; body: string }) => ask({ request: { cmd: 'skill-write', id, path, body }, doing: 'save the skill', schema: z.object({ written: z.string() }) }),
  usage: ({ since }: { since: number }) => ask({ request: { cmd: 'usage', since }, doing: 'read the agents\' usage', schema: z.object({ usage: z.record(z.string(), z.number()) }) }),
  unlinkWhatsapp: ({ id }: { id: string }) => ask({ request: { cmd: 'wa-unlink', id }, doing: 'unlink WhatsApp', schema: z.object({ unlinked: z.string() }) }),
  joinTailnet: ({ authKey }: { authKey: string }) => ask({ request: { cmd: 'ts-up', authKey }, doing: 'join the tailnet', schema: z.extend(Tailnet, { joined: z.boolean() }) }),
  tailnet: () => ask({ request: { cmd: 'ts-status' }, doing: 'read the Tailscale status', schema: Tailnet }),
  leaveTailnet: () => ask({ request: { cmd: 'ts-down' }, doing: 'leave the tailnet', schema: Tailnet }),
}

export async function containerStates(): Promise<Record<string, string> | undefined> {
  const reply = await agentd.ps().catch(() => undefined)
  return reply?.states
}

async function ask<S extends z.ZodMiniType>({ request, doing, schema }: { request: Record<string, unknown>; doing: string; schema: S }): Promise<z.output<S>> {
  const reply = await send({ request, doing })
  const failure = z.safeParse(Failure, reply)
  if (failure.success) throw new HttpError(502, `The agent runner couldn't ${doing}: ${failure.data.error}. Details are in /var/log/fastmonkey/agentd.log.`)
  const parsed = z.safeParse(schema, reply)
  if (!parsed.success) throw new HttpError(502, `The agent runner sent a reply the app doesn't understand while trying to ${doing}. Check that agentd and the app are the same release.`)
  return parsed.data
}

function send({ request, doing }: { request: Record<string, unknown>; doing: string }): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(config.agentdSocket)
    let buffer = ''
    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy()
      reject(new HttpError(504, `The agent runner didn't ${doing} in time. Try again.`))
    })
    socket.on('data', (chunk) => { buffer += chunk })
    socket.on('end', () => {
      try { resolve(JSON.parse(buffer)) } catch { reject(new HttpError(502, `The agent runner sent a broken reply while trying to ${doing}. Try again.`)) }
    })
    socket.on('error', (err) => reject(new HttpError(503, `The agent runner isn't reachable (${err.message}). Check that agentd is running.`)))
    socket.end(`${JSON.stringify(request)}\n`)
  })
}

export type AgentFiles = Record<'config.yaml' | '.env' | 'SOUL.md', string>
