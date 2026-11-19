import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import * as z from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { config } from '../platform/config.ts'
import { errorBody, HttpError, messageOf } from '../platform/http-error.ts'
import { log } from '../platform/events.ts'
import { serveMcp } from '../platform/mcp-transport.ts'
import { agentService, type GatewayAgent } from '../agents/agent-service.ts'
import { connectionService, type AgentTool } from '../connections/connection-service.ts'
import { testAnthropic, testModel } from './test-model.ts'
import { brokerService, upstreams } from './broker.ts'
import { cardService } from '../cards/card-service.ts'

const PER_AGENT = 8
const MAX_BODY = 1 << 20
const LIMITS = { requestTimeout: 60_000, headersTimeout: 10_000, connectionsCheckingInterval: 2_000 }
const inFlight = new Map<string, number>()
const RenderCard = z.object({ text: z.string().max(200_000), channel: z.string().max(40), chatId: z.string().max(200).optional(), threadId: z.string().max(200).optional() })

export const gatewayServer = {
  start({ port = config.gatewayPort }: { port?: number } = {}): Promise<void> {
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
  const token = /^(?:Agent|Bearer) (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1] ?? /^\/u\/telegram\/(?:file\/)?bot([^/]+)\//.exec(url.pathname)?.[1]
  const agent = token ? await agentService.byToken({ token }) : undefined
  if (!agent) return json(res, 401, errorBody({ status: 401, message: 'Send this agent\'s own token.' }))
  const open = inFlight.get(agent.id) ?? 0
  if (open >= PER_AGENT) return json(res, 429, errorBody({ status: 429, message: `This agent already has ${PER_AGENT} requests running. Wait for them.` }), true)
  inFlight.set(agent.id, open + 1)
  res.on('close', () => inFlight.set(agent.id, (inFlight.get(agent.id) ?? 1) - 1))
  const path = url.pathname
  const brokered = /^\/u\/([a-z]+)(\/.*)$/.exec(path)
  const upstream = brokered && upstreams.get(brokered[1])
  if (brokered && upstream) return brokerService.forward({ agent, upstream, path: brokered[2] + url.search, req, res })
  if (path === '/api/v1/mcp') return serveMcp({ server: agentMcp(agent), req, res, body: req.method === 'POST' ? await readBody(req) : undefined })
  if (path === '/cards/render' && req.method === 'POST') return json(res, 200, await cardService.render({ agent, ...renderRequest(await readBody(req)) }))
  if (path.startsWith('/test-llm/') && config.modelMode === 'test') return testModel({ path, body: await readBody(req), res })
  json(res, 404, errorBody({ status: 404, message: `No route ${path}.` }))
}

function agentMcp(agent: GatewayAgent): McpServer {
  const server = new McpServer({ name: 'openhut', version: config.version })
  const reason = z.string().min(1).max(500).describe('Why you need this, in a few words. Shown in the audit.')
  server.registerTool('list_tools', { description: 'List the tools you may call, one line each.', inputSchema: { app: z.string().max(40).optional() } }, async ({ app }) => {
    return text(toolList({ granted: await connectionService.tools({ agent }), app }))
  })
  server.registerTool('describe_tool', { description: 'Show the input schema of one or more tools.', inputSchema: { names: z.array(z.string().max(100)).min(1).max(20) } }, async ({ names }) => {
    const byName = new Map((await connectionService.tools({ agent })).map((tool) => [tool.name, tool.spec]))
    return text(JSON.stringify(names.map((name) => ({ name, schema: byName.get(name)?.schema ?? null, description: byName.get(name)?.description ?? 'Not available to this agent' }))))
  })
  server.registerTool('call_tool', {
    description: 'Run a tool from list_tools.',
    inputSchema: { reason, name: z.string().max(100), arguments: z.record(z.string(), z.unknown()).default({}), connectionId: z.string().max(100).optional() },
  }, async ({ reason: why, name, arguments: args, connectionId }) => {
    const result = await connectionService.call({ agent, name, args, connectionId, reason: why })
    return text(result.text, result.isError)
  })
  return server
}

export function toolList({ granted, app }: { granted: AgentTool[]; app: string | undefined }): string {
  const wanted = app?.trim().toLowerCase()
  const tools = granted.filter((tool) => !wanted || tool.connection.kind === wanted || tool.connection.name.toLowerCase() === wanted)
  const lines = tools.map((tool) => `${tool.name} [${tool.connection.name}, ${tool.connection.id}]: ${tool.spec.description}`.slice(0, 140))
  if (lines.length) return lines.slice(0, 100).join('\n')
  return granted.length ? `No app named ${app}. Leave app out to list every tool.` : 'No tools: nobody has granted this agent a connection yet.'
}

function renderRequest(body: unknown): z.infer<typeof RenderCard> {
  const parsed = RenderCard.safeParse(body)
  if (!parsed.success) throw new HttpError(400, 'Send the reply as text, with the channel it goes to.')
  return parsed.data
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

const text = (content: string, isError = false) => ({ content: [{ type: 'text' as const, text: content }], isError })
