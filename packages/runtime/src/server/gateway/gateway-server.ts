import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import * as z from 'zod'
import { config } from '../platform/config.ts'
import { errorBody, HttpError, messageOf } from '../platform/http-error.ts'
import { log } from '../platform/events.ts'
import { serveMcp } from '../platform/mcp-transport.ts'
import { agentService } from '../agents/agent-service.ts'
import { mcpOf } from '../../core/mcp.ts'
import { runHook, runLocal, runSlackAction } from '../../core/hooks.ts'
import { plugins } from '../../core/plugins.ts'
import { forward } from '../relay/forward.ts'
import { testAnthropic, testModel } from './test-model.ts'
import { brokerService, upstreams } from './broker.ts'
import { activity } from './activity.ts'
import { changeRequestService } from '../agents/change-request-service.ts'
import { inboxService } from '../inbox/inbox-service.ts'

export { toolList } from '../../plugins/connections/index.ts'

const PER_AGENT = 8
// Background polls (Telegram's long poll, the plugin's routines poll every 15 s) aren't the agent at work, so they don't count toward its request limit.
const LONG_POLL = /^(\/u\/telegram\/bot[^/]+\/getUpdates|\/routines\/due)$/
const MAX_BODY = 1 << 20
const LIMITS = { requestTimeout: 600_000, headersTimeout: 10_000, connectionsCheckingInterval: 2_000 }
const RunReport = z.object({ picked: z.literal(true).optional(), said: z.string().max(200_000).optional() })

export const gatewayServer = {
  start({ port = config.gatewayPort }: { port?: number } = {}): Promise<void> {
    plugins()
    return new Promise((resolve, reject) => {
      gatewayServer.create().once('error', reject).listen(port, config.agentGateway ? '127.0.0.1' : '0.0.0.0', () => {
        log.info({ event: 'gateway.listening', port })
        resolve()
      })
    })
  },

  create(): Server {
    return createServer(LIMITS, (req, res) => void handle(req, res).catch((err: unknown) => fail(res, err)))
  },
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://gateway')
  if (url.pathname.startsWith('/test-anthropic/') && config.modelMode === 'test') return testAnthropic({ req, body: await readBody(req), res })
  const token = /^(?:Agent|Bearer) (?:xoxb-oh-|xapp-oh-)?(.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? /^\/u\/telegram\/(?:file\/)?bot([^/]+)\//.exec(url.pathname)?.[1]
  const agent = token ? await agentService.byToken({ token, from: forward.relayedFrom(req.socket.remotePort) }) : undefined
  if (!agent) return json(res, 401, errorBody({ status: 401, message: 'Send this agent\'s own token.' }))
  const path = url.pathname
  const mcp = path === '/api/v1/mcp' && req.method === 'POST' ? await readBody(req) : undefined
  // Hermes's MCP keepalives and tool listings aren't work either; only a tool call is.
  const listening = LONG_POLL.test(path) || (path === '/api/v1/mcp' && ![mcp].flat().some((message) => (message as { method?: string } | undefined)?.method === 'tools/call'))
  if (!listening && activity.count(agent.id) >= PER_AGENT) return json(res, 429, errorBody({ status: 429, message: `This agent already has ${PER_AGENT} requests running. Wait for them.` }), true)
  if (!listening) {
    activity.started(agent.id)
    res.on('close', () => activity.ended(agent.id))
  }
  const keyed = /^\/x\/([^/]+)(\/.*)?$/.exec(path)
  if (keyed) return brokerService.withSecrets({ agent, host: keyed[1].toLowerCase(), path: (keyed[2] ?? '/') + url.search, req, res })
  const brokered = /^\/u\/([a-z]+)(\/.*)$/.exec(path)
  const upstream = brokered && upstreams.get(brokered[1])
  if (brokered && upstream) return brokerService.forward({ agent, upstream, path: brokered[2] + url.search, req, res })
  if (path === '/api/v1/mcp') return serveMcp({ server: mcpOf(agent), req, res, body: mcp })
  if (path === '/routines/due' && req.method === 'GET') return json(res, 200, { object: 'list', url: path, hasMore: false, data: [...await inboxService.due({ agentId: agent.id }), ...await changeRequestService.due({ agentId: agent.id })] })
  const run = /^\/routines\/runs\/((?:ru|chg|hd)_[a-z0-9]+)$/.exec(path)
  if (run && req.method === 'POST') return json(res, 200, await reportRun({ agentId: agent.id, runId: run[1], body: await readBody(req) }))
  const local = /^\/tools\/(\w+)$/.exec(path)
  if (local && req.method === 'POST') return json(res, 200, await runLocal({ agent, name: local[1], body: await readBody(req) }))
  if (path === '/slack-actions' && req.method === 'POST') return json(res, 200, await runSlackAction({ agent, body: await readBody(req) }))
  const hook = /^\/hooks\/(\w+)$/.exec(path)
  if (hook && req.method === 'POST') return json(res, 200, await runHook({ agent, hook: hook[1], body: await readBody(req) }))
  if (path.startsWith('/test-llm/') && config.modelMode === 'test') return testModel({ path, body: await readBody(req), res })
  json(res, 404, errorBody({ status: 404, message: `No route ${path}.` }))
}

async function reportRun({ agentId, runId, body }: { agentId: string; runId: string; body: unknown }): Promise<{ object: 'routine_run'; id: string }> {
  const parsed = RunReport.safeParse(body)
  if (!parsed.success || (!parsed.data.picked && parsed.data.said === undefined)) throw new HttpError(400, 'Send picked: true, or said with the reply.')
  if (runId.startsWith('chg_')) {
    if (!parsed.data.picked) throw new HttpError(400, 'Send picked: true.')
    await changeRequestService.picked({ agentId, id: runId })
  } else if (parsed.data.picked) await inboxService.picked({ agentId, id: runId })
  else await inboxService.report({ agentId, runId, said: parsed.data.said ?? '' })
  return { object: 'routine_run', id: runId }
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new HttpError(413, 'Requests to the gateway are limited to 1 MB.')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return undefined
  try { return JSON.parse(raw) } catch { throw new HttpError(400, 'The request body isn\'t valid JSON.') }
}

function fail(res: ServerResponse, err: unknown): void {
  const status = err instanceof HttpError ? err.status : 500
  if (status === 500) log.error({ event: 'gateway.error', error: messageOf(err) })
  if (!res.headersSent) json(res, status, errorBody({ status, message: err instanceof HttpError ? err.message : 'The gateway failed. Try again.' }), true)
}

function json(res: ServerResponse, status: number, body: unknown, close = false): void {
  res.writeHead(status, { 'content-type': 'application/json', ...(close && { connection: 'close' }) }).end(JSON.stringify(body))
}

