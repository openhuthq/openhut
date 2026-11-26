import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { pipeline } from 'node:stream/promises'
import { db } from '../platform/db.ts'
import { config } from '../platform/config.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import type { GatewayAgent } from '../agents/agent-service.ts'
import { channelService } from '../channels/channel-service.ts'
import { STAND_IN } from '../integrations/slack/slack.ts'
import { providers } from '../models/providers/index.ts'
import { github } from '../integrations/github/github.ts'
import { secretService, type HeldSecret } from '../agents/secret-service.ts'
import { guardedLookup } from '../platform/network.ts'

const IDLE_MS = 120_000
const QUIET_MS = 60_000
const STRIPPED = new Set(['authorization', 'x-api-key', 'cookie', 'proxy-authorization', 'chatgpt-account-id', 'host', 'connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-connection'])
const UNRELAYED = new Set(['connection', 'keep-alive', 'transfer-encoding', 'set-cookie', 'alt-svc', 'strict-transport-security'])
const TELEGRAM_REFUSED = new Set(['logout', 'close', 'setwebhook'])
const TELEGRAM_PATH = /^\/(?:file\/)?bot[^/]+\/([^/]+)/
const GIT_PATH = /^\/([A-Za-z0-9][\w-]*\/[\w.-]+?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/
const GIT_VERB: Record<string, string> = { 'info/refs': 'refs', 'git-upload-pack': 'fetch from', 'git-receive-pack': 'push to' }
const GIT_PUSH = /\/git-receive-pack$|[?&]service=git-receive-pack(?:&|$)/
const GIT_IDLE_MS = 600_000
const GIT_FETCH_MS = 10_000
const PLACEHOLDER = /openhut-secret-([A-Z][A-Z0-9_]{1,39})/g
const lastQuiet = new Map<string, number>()

export const keyedRoute = { origin: (host: string): string => `https://${host}` }

export type Upstream = {
  name: string
  origin: string
  allow: (req: { method: string; path: string }) => boolean
  credential: (agent: GatewayAgent, incoming: IncomingHttpHeaders, path: string) => Promise<string>
  apply: (req: { out: Outgoing; secret: string }) => void
  observe?: (headers: Headers) => void
  body?: (json: Record<string, unknown>) => Record<string, unknown>
  tool?: (path: string) => string | undefined
  idleMs?: number
  lookup?: typeof guardedLookup
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
  ['slack', {
    name: 'slack',
    origin: new URL(config.slackApi).origin,
    allow: ({ path }) => /^\/api\/[a-z]+(?:\.[a-zA-Z]+)+$/.test(path),
    credential: (agent, incoming) => channelService.slackToken({ agentId: agent.id, app: String(incoming.authorization ?? '').startsWith(`Bearer ${STAND_IN.app}`) }),
    apply: ({ out, secret }) => { out.headers.set('authorization', `Bearer ${secret}`) },
  }],
  ['slackfiles', {
    name: 'slackfiles',
    origin: config.slackFiles,
    allow: ({ method, path }) => method === 'GET' && /^\/files-(?:pri|tmb)\//.test(path),
    credential: (agent) => channelService.slackToken({ agentId: agent.id }),
    apply: ({ out, secret }) => { out.headers.set('authorization', `Bearer ${secret}`) },
  }],
  ['github', {
    name: 'github',
    origin: 'https://github.com',
    allow: ({ method, path }) => {
      const match = GIT_PATH.exec(path)
      return !!match && method === (match[2] === 'info/refs' ? 'GET' : 'POST')
    },
    credential: (agent, _incoming, path) => github.gitToken({ agentId: agent.id, push: GIT_PUSH.test(path) }),
    apply: ({ out, secret }) => { out.headers.set('authorization', `Basic ${Buffer.from(`x-access-token:${secret}`).toString('base64')}`) },
    tool: (path) => {
      const match = GIT_PATH.exec(path)
      return match ? `github ${GIT_VERB[match[2]]} ${match[1]}` : undefined
    },
    idleMs: GIT_IDLE_MS,
  }],
])

export const brokerService = {
  async forward({ agent, upstream, path, req, res, idleMs = upstream.idleMs ?? IDLE_MS }: Forward): Promise<void> {
    const started = Date.now()
    const method = req.method ?? 'GET'
    const pathname = path.split('?')[0]
    const tool = upstream.tool?.(pathname) ?? `${upstream.name} ${method} ${pathname.replace(/\/bot[^/]+/, '/bot…')}`
    if (!upstream.allow({ method, path: pathname })) {
      await audit({ agent, tool, reason: 'Not on the allowed list', outcome: 'denied', started })
      throw new HttpError(403, `The gateway doesn't pass ${tool} through.`)
    }
    const out = { path, headers: forwardable(req.headers) }
    upstream.apply({ out, secret: await upstream.credential(agent, req.headers, path) })
    const body = upstream.body && method === 'POST' ? await rewritten({ req, headers: out.headers, change: upstream.body }) : req
    const status = await relay({ url: new URL(upstream.origin + out.path), method, headers: out.headers, body, res, idleMs, observe: upstream.observe, lookup: upstream.lookup })
      .catch(async (err: unknown) => {
        await audit({ agent, tool, reason: messageOf(err).slice(0, 200), outcome: 'failed', started })
        throw err
      })
    await audit({ agent, tool, reason: `HTTP ${status}`, outcome: status < 400 ? 'allowed' : 'failed', started })
  },

  async withSecrets({ agent, host, path, req, res }: { agent: GatewayAgent; host: string; path: string; req: IncomingMessage; res: ServerResponse }): Promise<void> {
    const secrets = await secretService.held({ agentId: agent.id })
    const named = new Set([...Object.values(req.headers).flat(), path].flatMap((text) => [...String(text ?? '').matchAll(PLACEHOLDER)].map((match) => match[1])))
    const strays = [...named].filter((name) => !secrets.some((secret) => secret.name === name && secret.hosts.includes(host)))
    const tool = `${host} ${req.method ?? 'GET'} ${path.split('?')[0]}`
    if (strays.length) {
      await audit({ agent, tool, reason: `Refused: ${strays.join(', ')} may not go to ${host}`, outcome: 'denied', started: Date.now() })
      throw new HttpError(403, `The gateway won't send ${strays.join(', ')} to ${host}: ${strays.map((name) => routeOf({ secrets, name })).join(' ')}`)
    }
    const misplaced = [...new Set([
      ...[...path.matchAll(PLACEHOLDER)].map((match) => match[1]),
      ...Object.entries(req.headers).flatMap(([header, value]) => [...String(value ?? '').matchAll(PLACEHOLDER)].map((match) => match[1]).filter((name) => headerOf(secrets.find((secret) => secret.name === name)) !== header)),
    ])]
    if (misplaced.length) {
      await audit({ agent, tool, reason: `Refused: ${misplaced.join(', ')} outside its header`, outcome: 'denied', started: Date.now() })
      throw new HttpError(403, `The gateway puts ${misplaced.join(', ')} only in the header your owner set for it, never in the URL or another header. Leave the stand-in out: OpenHut adds the key for you.`)
    }
    const sent = secrets.filter((secret) => secret.hosts.includes(host))
    if (!sent.length) throw new HttpError(403, `None of your keys go to ${host}. Call https://${host} directly, or ask for a key with add_secret.`)
    await brokerService.forward({
      agent, path, req, res,
      upstream: {
        name: host, origin: keyedRoute.origin(host), allow: () => true, credential: async () => '', tool: () => tool, lookup: guardedLookup,
        apply: ({ out }) => {
          for (const secret of sent) {
            const [header, format] = splitHeader(secret.header)
            out.headers.set(header, format.replaceAll('{value}', secret.value))
          }
        },
      },
    })
    await secretService.used({ ids: sent.map((secret) => secret.id) })
  },
}

function headerOf(secret: HeldSecret | undefined): string | undefined {
  return secret && splitHeader(secret.header)[0].toLowerCase()
}

function splitHeader(header: string): [string, string] {
  const at = header.indexOf(': ')
  return [header.slice(0, at), header.slice(at + 2)]
}

function routeOf({ secrets, name }: { secrets: HeldSecret[]; name: string }): string {
  const secret = secrets.find((each) => each.name === name)
  return secret ? `${name} only goes to ${secret.hosts.join(', ')}.` : `You have no key named ${name}.`
}

async function rewritten({ req, headers, change }: { req: IncomingMessage; headers: Headers; change: (json: Record<string, unknown>) => Record<string, unknown> }): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  let json: unknown
  try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HttpError(400, 'The gateway needs a JSON body here.') }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new HttpError(400, 'The gateway needs a JSON body here.')
  const out = Buffer.from(JSON.stringify(change(json as Record<string, unknown>)))
  headers.set('content-length', String(out.length))
  return out
}

function relay({ url, method, headers, body, res, idleMs, observe, lookup }: { url: URL; method: string; headers: Headers; body: IncomingMessage | Buffer; res: ServerResponse; idleMs: number; observe?: (headers: Headers) => void; lookup?: typeof guardedLookup }): Promise<number> {
  return new Promise((resolve, reject) => {
    const outgoing = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method, headers: Object.fromEntries(headers), ...(lookup && { lookup }) }, (answer) => {
      const status = answer.statusCode ?? 502
      observe?.(headersOf(answer.headers))
      res.writeHead(status, Object.fromEntries(Object.entries(answer.headers).filter(([name]) => !UNRELAYED.has(name))))
      pipeline(answer, res).then(() => resolve(status), (err: unknown) => reject(err instanceof Error ? err : new Error(messageOf(err))))
    })
    outgoing.setTimeout(idleMs, () => outgoing.destroy(new HttpError(504, `The upstream sent nothing for ${idleMs / 1000} seconds.`)))
    outgoing.on('error', (err) => reject(res.headersSent ? err : new HttpError(err instanceof HttpError ? err.status : 502, err instanceof HttpError ? err.message : `The upstream didn't answer (${err.message}).`)))
    res.on('close', () => { if (!res.writableFinished) outgoing.destroy() })
    if (Buffer.isBuffer(body)) outgoing.end(body)
    else pipeline(body, outgoing).catch(() => outgoing.destroy())
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
  if (outcome === 'allowed' && tool.startsWith('github refs ')) return
  const quietMs = quietFor(tool)
  if (outcome === 'allowed' && quietMs) {
    const key = `${agent.id} ${tool}`
    if (started - (lastQuiet.get(key) ?? 0) < quietMs) return
    lastQuiet.set(key, started)
  }
  await db.insertInto('connection_event').values({ agent_id: agent.id, connection_id: null, tool, reason, outcome, ms: Date.now() - started }).execute()
}

function quietFor(tool: string): number {
  if (tool.endsWith('/getUpdates')) return QUIET_MS
  if (tool.startsWith('github fetch from ')) return GIT_FETCH_MS
  return 0
}

type Forward = { agent: GatewayAgent; upstream: Upstream; path: string; req: IncomingMessage; res: ServerResponse; idleMs?: number }
