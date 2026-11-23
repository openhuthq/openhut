import type { WebSocket } from '@fastify/websocket'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import * as z from 'zod/mini'
import { connect, type Tunnel } from '@openhut/tunnel'
import { agentService } from '../agents/agent-service.ts'
import { channelService } from '../channels/channel-service.ts'
import { keysService } from '../cloud/keys-service.ts'
import { config } from '../platform/config.ts'
import { db } from '../platform/db.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { fromTunnel, memberOf, tunnelKeyOf, who } from '../team/identity.ts'
import { relayIdOf, tunnelKey } from './relay-service.ts'

const MAX_REASON = 120
const Id = z.object({ id: z.string() })
const ByAgent = z.object({ agentId: z.string() })
const tunnels = new Map<string, Promise<Tunnel>>()
const RUNNER_OF: Partial<Record<string, (req: FastifyRequest) => Promise<string | undefined>>> = {
  'GET /api/threads/:id': (req) => runnerOf(idOf(req)),
  'DELETE /api/threads/:id': (req) => runnerOf(idOf(req)),
  'POST /api/threads/:id/chat': (req) => runnerOf(idOf(req)),
  'GET /api/threads/:id/files': (req) => runnerOf(idOf(req)),
  'POST /api/threads/:id/files': (req) => runnerOf(idOf(req)),
  'DELETE /api/threads/:id/files': (req) => runnerOf(idOf(req)),
  'POST /api/threads/:id/files/lookups': (req) => runnerOf(idOf(req)),
  'GET /api/channels/:id': async (req) => runnerOf(await channelService.agentOf({ id: idOf(req) })),
  'GET /api/connection-events': (req) => runnerOf(z.safeParse(ByAgent, req.query).data?.agentId),
}

export const forward = {
  async http(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    const find = RUNNER_OF[`${req.method} ${req.routeOptions.url ?? ''}`]
    const key = find && !fromTunnel(req) ? await find(req) : undefined
    if (!key) return undefined
    await who(req)
    return reply.send(await fetchOn({ key, path: req.url, init: { method: req.method, headers: headersOf(req), body: bodyOf(req) } }))
  },

  async socket({ socket, req, agentId }: { socket: WebSocket; req: FastifyRequest; agentId: string }): Promise<boolean> {
    const key = fromTunnel(req) ? undefined : await runnerOf(agentId)
    if (!key) return false
    try {
      await who(req)
      const remote = (await open(key)).socket(req.url)
      remote.onmessage = ({ data }) => socket.send(data)
      remote.onclose = ({ code, reason }) => socket.close(code === 1000 || code >= 3000 ? code : 1011, reason.slice(0, MAX_REASON))
      socket.on('message', (data, binary) => remote.send(binary ? new Uint8Array(data as Buffer) : String(data)))
      socket.on('close', () => remote.close())
    } catch (error) {
      socket.close(4000 + (error instanceof HttpError ? error.status : 502), messageOf(error).slice(0, MAX_REASON))
    }
    return true
  },
}

export const forwardController: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { key: string } }>('/:key/api/updates', async (req, reply) => {
    await who(req)
    if (!memberOf(req.params.key)?.own) throw new HttpError(404, 'That computer isn’t one of yours.', { param: 'key' })
    return reply.send(await fetchOn({ key: req.params.key, path: '/api/updates', init: { method: 'POST' } }))
  })
}

async function runnerOf(agentId: string | undefined): Promise<string | undefined> {
  if (!agentId || await db.selectFrom('agent').select('id').where('id', '=', agentId).executeTakeFirst()) return undefined
  const runsOn = (await agentService.find({ id: agentId }).catch(() => null))?.control?.runsOn
  if (!runsOn || runsOn === await keysService.deviceKey()) return undefined
  return tunnelKeyOf(runsOn)
}

async function fetchOn({ key, path, init }: { key: string; path: string; init: RequestInit }): Promise<Response> {
  try {
    return await (await open(key)).fetch(path, init)
  } catch {
    tunnels.delete(key)
    throw new HttpError(502, 'The computer that runs this isn’t answering. It may be off or offline.')
  }
}

function open(key: string): Promise<Tunnel> {
  const held = tunnels.get(key)
  if (held) return held.then((tunnel) => tunnel.failure ? reopen(key) : tunnel)
  return reopen(key)
}

function reopen(key: string): Promise<Tunnel> {
  if (!config.relayUrl) return Promise.reject(new HttpError(502, 'This copy of OpenHut has no relay to reach its other computers.'))
  const relayUrl = config.relayUrl
  const opening = Promise.all([tunnelKey(), keysService.token()]).then(([mine, token]) => connect({ relayUrl, computer: { id: relayIdOf(Buffer.from(key, 'hex')), key }, key: mine, token }))
  tunnels.set(key, opening)
  opening.catch(() => { if (tunnels.get(key) === opening) tunnels.delete(key) })
  return opening
}

function idOf(req: FastifyRequest): string {
  return z.safeParse(Id, req.params).data?.id ?? ''
}

function headersOf(req: FastifyRequest): Record<string, string> {
  const { 'content-type': type, accept } = req.headers
  return { ...type && { 'content-type': type }, ...accept && { accept } }
}

function bodyOf(req: FastifyRequest): string | Uint8Array | undefined {
  if (req.body === undefined || req.body === null) return undefined
  return Buffer.isBuffer(req.body) ? new Uint8Array(req.body) : JSON.stringify(req.body)
}
