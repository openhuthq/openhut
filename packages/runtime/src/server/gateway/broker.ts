import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { pipeline } from 'node:stream/promises'
import { db } from '../platform/db.ts'
import { config } from '../platform/config.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import type { GatewayAgent } from '../agents/agent-service.ts'
import { channelService } from '../channels/channel-service.ts'
import { providers } from '../models/providers.ts'

const IDLE_MS = 120_000
const QUIET_MS = 60_000
const STRIPPED = new Set(['authorization', 'x-api-key', 'cookie', 'proxy-authorization', 'chatgpt-account-id', 'host', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-connection'])
const UNRELAYED = new Set(['connection', 'keep-alive', 'transfer-encoding', 'set-cookie', 'alt-svc', 'strict-transport-security'])
const TELEGRAM_REFUSED = new Set(['logout', 'close', 'setwebhook'])
const TELEGRAM_PATH = /^\/(?:file\/)?bot[^/]+\/([^/]+)/
const lastQuiet = new Map<string, number>()

export type Upstream = {
  name: string
  origin: string
  allow: (req: { method: string; path: string }) => boolean
  credential: (agent: GatewayAgent) => Promise<string>
  apply: (req: { out: Outgoing; secret: string }) => void
  observe?: (headers: Headers) => void
}

export type Outgoing = { path: string; headers: Headers }

export const upstreams = new Map<string, Upstream>([
  ...Object.values(providers).map((provider): [string, Upstream] => [provider.upstream.name, provider.upstream]),
  ['telegram', {
    name: 'telegram',
    origin: config.telegramApi,
    allow: ({ path }) => {
      const method = TELEGRAM_PATH.exec(path)?.[1]
      return !!method && (path.startsWith('/file/') || /^[A-Za-z]+$/.test(method)) && !TELEGRAM_REFUSED.has(method.toLowerCase())
    },
    credential: (agent) => channelService.telegramToken({ agentId: agent.id }),
    apply: ({ out, secret }) => { out.path = out.path.replace(/^(\/(?:file\/)?bot)[^/]+/, `$1${secret}`) },
  }],
])

export const brokerService = {
  async forward({ agent, upstream, path, req, res, idleMs = IDLE_MS }: Forward): Promise<void> {
    const started = Date.now()
    const method = req.method ?? 'GET'
    const pathname = path.split('?')[0]
    const tool = `${upstream.name} ${method} ${pathname.replace(/\/bot[^/]+/, '/bot…')}`
    if (!upstream.allow({ method, path: pathname })) {
      await audit({ agent, tool, reason: 'Not on the allowed list', outcome: 'denied', started })
      throw new HttpError(403, `The gateway doesn't pass ${tool} through.`)
    }
    const out = { path, headers: forwardable(req.headers) }
    upstream.apply({ out, secret: await upstream.credential(agent) })
    const status = await relay({ url: new URL(upstream.origin + out.path), method, headers: out.headers, req, res, idleMs, observe: upstream.observe })
      .catch(async (err: unknown) => {
        await audit({ agent, tool, reason: messageOf(err).slice(0, 200), outcome: 'failed', started })
        throw err
      })
    await audit({ agent, tool, reason: `HTTP ${status}`, outcome: status < 400 ? 'allowed' : 'failed', started })
  },
}

function relay({ url, method, headers, req, res, idleMs, observe }: { url: URL; method: string; headers: Headers; req: IncomingMessage; res: ServerResponse; idleMs: number; observe?: (headers: Headers) => void }): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method, headers: Object.fromEntries(headers) }, (answer) => {
      const status = answer.statusCode ?? 502
      observe?.(headersOf(answer.headers))
      res.writeHead(status, Object.fromEntries(Object.entries(answer.headers).filter(([name]) => !UNRELAYED.has(name))))
      pipeline(answer, res).then(() => resolve(status), (err: unknown) => reject(err instanceof Error ? err : new Error(messageOf(err))))
    })
    outgoing.setTimeout(idleMs, () => outgoing.destroy(new HttpError(504, `The upstream sent nothing for ${idleMs / 1000} seconds.`)))
    outgoing.on('error', (err) => reject(res.headersSent ? err : new HttpError(err instanceof HttpError ? err.status : 502, err instanceof HttpError ? err.message : `The upstream didn't answer (${err.message}).`)))
    res.on('close', () => { if (!res.writableFinished) outgoing.destroy() })
    pipeline(req, outgoing).catch(() => outgoing.destroy())
  })
}

function forwardable(incoming: IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined || STRIPPED.has(name)) continue
    headers.set(name, Array.isArray(value) ? value.join(', ') : value)
  }
  return headers
}

function headersOf(incoming: IncomingHttpHeaders): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming)) if (typeof value === 'string') headers.set(name, value)
  return headers
}

async function audit({ agent, tool, reason, outcome, started }: { agent: GatewayAgent; tool: string; reason: string; outcome: 'allowed' | 'denied' | 'failed'; started: number }): Promise<void> {
  if (outcome === 'allowed' && tool.endsWith('/getUpdates')) {
    const key = `${agent.id} ${tool}`
    if (started - (lastQuiet.get(key) ?? 0) < QUIET_MS) return
    lastQuiet.set(key, started)
  }
  await db.insertInto('connection_event').values({ agent_id: agent.id, connection_id: null, tool, reason, outcome, ms: Date.now() - started }).execute()
}

type Forward = { agent: GatewayAgent; upstream: Upstream; path: string; req: IncomingMessage; res: ServerResponse; idleMs?: number }
