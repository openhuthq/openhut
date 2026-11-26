import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import * as z from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { config } from '../platform/config.ts'
import { errorBody, HttpError, messageOf } from '../platform/http-error.ts'
import { log } from '../platform/events.ts'
import { serveMcp } from '../platform/mcp-transport.ts'
import { agentService, type GatewayAgent } from '../agents/agent-service.ts'
import { forward } from '../relay/forward.ts'
import { connectionService, type AgentTool } from '../connections/connection-service.ts'
import { testAnthropic, testModel } from './test-model.ts'
import { brokerService, upstreams } from './broker.ts'
import { activity } from './activity.ts'
import { cardService } from '../cards/card-service.ts'
import { routineService } from '../routines/routine-service.ts'
import { changeRequestService } from '../agents/change-request-service.ts'
import { channelService } from '../channels/channel-service.ts'
import { db } from '../platform/db.ts'
import type { ChangeAction } from '@openhut/common/agents/change-request.ts'
import { askCard, MCP_AUTH } from '@openhut/common/asks/ask.ts'
import { ConnectionKind } from '@openhut/common/connections/connection.ts'

const PER_AGENT = 8
// Background polls (Telegram's long poll, the plugin's routines poll every 15 s) aren't the agent at work, so they don't count toward its request limit.
const LONG_POLL = /^(\/u\/telegram\/bot[^/]+\/getUpdates|\/routines\/due)$/
const MAX_BODY = 1 << 20
const LIMITS = { requestTimeout: 600_000, headersTimeout: 10_000, connectionsCheckingInterval: 2_000 }
const RunReport = z.object({ picked: z.literal(true).optional(), said: z.string().max(200_000).optional() })
const TelegramJoin = z.object({ code: z.string().max(64), userId: z.string().regex(/^[1-9]\d{4,14}$/), name: z.string().max(100).default('there'), chatId: z.number() })
const MessageTarget = z.object({ channel: z.string().max(40), chat: z.string().max(200).optional() })
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
  const brokered = /^\/u\/([a-z]+)(\/.*)$/.exec(path)
  const upstream = brokered && upstreams.get(brokered[1])
  if (brokered && upstream) return brokerService.forward({ agent, upstream, path: brokered[2] + url.search, req, res })
  if (path === '/api/v1/mcp') return serveMcp({ server: agentMcp(agent), req, res, body: mcp })
  if (path === '/routines/due' && req.method === 'GET') return json(res, 200, { object: 'list', url: path, hasMore: false, data: [...await routineService.due({ agentId: agent.id }), ...await changeRequestService.due({ agentId: agent.id })] })
  const run = /^\/routines\/runs\/((?:ru|chg)_[a-z0-9]+)$/.exec(path)
  if (run && req.method === 'POST') return json(res, 200, await reportRun({ agentId: agent.id, runId: run[1], body: await readBody(req) }))
  if (path === '/messages/target' && req.method === 'POST') return json(res, 200, await messageTarget({ agentId: agent.id, body: await readBody(req) }))
  if (path === '/telegram/joins' && req.method === 'POST') return json(res, 200, await telegramJoin({ agentId: agent.id, body: await readBody(req) }))
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
    description: 'Run a tool from list_tools. Some tools wait for your owner\'s OK: then the call returns at once, and the result comes back to you as a message.',
    inputSchema: z.object({ reason, name: z.string().max(100), arguments: z.record(z.string(), z.unknown()).default({}), connectionId: z.string().max(100).optional() }).passthrough(),
  }, async ({ reason: why, name, arguments: args, connectionId, origin }) => {
    const result = await connectionService.call({ agent, name, args, connectionId, reason: why, origin })
    return text(result.text, result.isError)
  })
  server.registerTool('ask_to_connect', {
    description: 'Ask the person to connect an app you need and can\'t reach yet. You get a card: put it in your reply. One app at a time.',
    inputSchema: {
      app: z.enum(ConnectionKind.options),
      why: z.string().min(1).max(300).describe('One or two sentences for the person: what you will do with it, and how to make the access if they need to (a read-only role, a token\'s scopes).'),
      url: z.url({ protocol: /^https$/ }).max(500).optional().describe('For app mcp: the server\'s URL.'),
      name: z.string().min(1).max(60).optional().describe('For app mcp: what to call it, like DigitalOcean.'),
      auth: z.enum(MCP_AUTH).optional().describe('For app mcp: how the server lets you in. header for a token (DigitalOcean), sign_in for OAuth (Cloudflare\'s servers, like https://observability.mcp.cloudflare.com/mcp), public for none.'),
    },
  }, async ({ app, why, url, name, auth }) => {
    if ((url || name || auth) && app !== 'mcp') return text('Only app mcp takes a url, a name or auth. Leave them out.', true)
    if (app === 'mcp' && !url) return text('Send the MCP server\'s url with app mcp.', true)
    return text(`Put this card in your reply, after a sentence on what you need:\n\n${askCard({ agentId: agent.id, app, url, name, auth, why })}`)
  })
  server.registerTool('schedule_routine', {
    description: 'Use this whenever something needs a follow-up later: a promise you made, a reply you\'re waiting on, a date someone mentioned. Don\'t wait to be asked. Then tell the person in one line what you set up. Check list_routines first, and don\'t set up the same follow-up twice. Each run starts in the chat where you call this, with that chat\'s history.',
    inputSchema: z.object({
      name: z.string().min(1).max(80).describe('Starts with a verb, plain words: "Chase Acme on invoice #4471".'),
      plan: z.string().min(1).max(2000).describe('Written to yourself: what to check, when to speak up, when to stop.'),
      at: z.string().max(40).optional().describe('ISO time with an offset, for a one-time routine, like 2026-11-28T09:00:00+01:00.'),
      cron: z.string().max(100).optional().describe('Minute hour day month weekday, in the owner\'s time zone, for a repeating one, like 0 10 * * 1-5. At most every 15 minutes.'),
      until: z.string().max(40).optional().describe('ISO time; a repeating routine stops then. At most 90 days ahead, the default.'),
    }).passthrough(),
  }, async (input) => text(await routineService.schedule({ agentId: agent.id, input })))
  server.registerTool('list_routines', { description: 'List your routines, one line each.' }, async () => text(await routineService.listForAgent({ agentId: agent.id })))
  server.registerTool('cancel_routine', {
    description: 'Use this when what you were following up on is done, or no longer needed. Tell the chat first: the routine leaves the owner\'s list.',
    inputSchema: { id: z.string().max(40), reason: z.string().max(200).describe('Short, past tense, for the log: "Paid on Nov 26".') },
  }, async ({ id, reason }) => text(await routineService.cancel({ agentId: agent.id, id, reason })))
  server.registerTool('get_self', { description: 'Your name, instructions and channels, where post_message can post (postTo), the connections you have, and the ones you can ask for. Read it before you ask to change any of them.' }, async () => text(await selfOf(agent)))
  const why = z.string().min(1).max(300).describe('One sentence for your owner: why this change, in plain words.')
  const ask = ({ name, action, description, shape }: { name: string; action: ChangeAction; description: string; shape: z.ZodRawShape }) => server.registerTool(name, {
    description: `${description} Your owner approves it in OpenHut first: the call returns at once, and the answer comes back to you as a message.`,
    inputSchema: z.object({ why, ...shape }).passthrough(),
  }, async ({ why: reason, origin, ...input }: Record<string, unknown>) => text(await changeRequestService.ask({ agentId: agent.id, action, input, why: String(reason), origin })))
  ask({ name: 'update_self', action: 'update_self', description: 'Ask to change your own name or instructions. Send the whole new instructions, not a diff.', shape: { name: z.string().min(1).max(40).optional(), instructions: z.string().max(20_000).optional() } })
  ask({
    name: 'add_channel', action: 'add_channel', description: 'Ask to add WhatsApp, Telegram or Discord, so people can message you there. Slack needs a Slack app, so your owner adds it in OpenHut.',
    shape: {
      kind: z.enum(['whatsapp', 'telegram', 'discord']),
      ownerAddress: z.string().max(40).optional().describe('WhatsApp and Telegram: your owner\'s WhatsApp number with country code (+15551234567), or their numeric Telegram user ID.'),
      open: z.boolean().optional().describe('WhatsApp and Telegram: true lets anyone message you; false only your owner and allowed.'),
      allowed: z.array(z.string().max(40)).max(50).default([]).describe('Other numbers or Telegram IDs that may message you. For Discord: the channel IDs to answer in.'),
      botToken: z.string().max(200).optional().describe('For Telegram: the token BotFather gave, like 123456789:AAE…. For Discord: the bot token from the Developer Portal\'s Bot page.'),
    },
  })
  ask({ name: 'update_channel', action: 'update_channel', description: 'Ask to change who can message you on one of your channels.', shape: { id: z.string().max(40), open: z.boolean().optional(), allowed: z.array(z.string().max(20)).max(50).optional().describe('The whole new list.') } })
  ask({ name: 'remove_channel', action: 'remove_channel', description: 'Ask to remove one of your channels.', shape: { id: z.string().max(40) } })
  ask({ name: 'request_connection', action: 'request_connection', description: 'Ask for a connection that already exists in OpenHut (get_self lists them). For an app nobody connected yet, use ask_to_connect.', shape: { connectionId: z.string().max(40) } })
  return server
}

async function selfOf(agent: GatewayAgent): Promise<string> {
  const [row, channels, connections, grants, postTo] = await Promise.all([
    db.selectFrom('agent').select(['name', 'instructions']).where('id', '=', agent.id).executeTakeFirstOrThrow(),
    channelService.list({ agentId: agent.id }),
    db.selectFrom('connection').select(['id', 'name', 'kind']).orderBy('created_at').execute(),
    db.selectFrom('connection_grant').select('connection_id').where('agent_id', '=', agent.id).execute(),
    channelService.postTargets({ agentId: agent.id }),
  ])
  const have = new Set(grants.map((grant) => grant.connection_id))
  return JSON.stringify({
    name: row.name,
    instructions: row.instructions,
    channels: channels.map(({ id, kind, status, account, open, allowed }) => ({ id, kind, status, account, open, allowed })),
    connections: connections.filter((each) => have.has(each.id)),
    canAskFor: connections.filter((each) => !have.has(each.id)),
    postTo: postTo.map(({ channel, chat, place }) => ({ channel, chat, place })),
  }, null, 2)
}

async function reportRun({ agentId, runId, body }: { agentId: string; runId: string; body: unknown }): Promise<{ object: 'routine_run'; id: string }> {
  const parsed = RunReport.safeParse(body)
  if (!parsed.success || (!parsed.data.picked && parsed.data.said === undefined)) throw new HttpError(400, 'Send picked: true, or said with the reply.')
  if (runId.startsWith('chg_')) {
    if (!parsed.data.picked) throw new HttpError(400, 'Send picked: true.')
    await changeRequestService.picked({ agentId, id: runId })
  } else if (parsed.data.picked) await routineService.picked({ agentId, runId })
  else await routineService.report({ agentId, runId, said: parsed.data.said ?? '' })
  return { object: 'routine_run', id: runId }
}

export function toolList({ granted, app }: { granted: AgentTool[]; app: string | undefined }): string {
  const wanted = app?.trim().toLowerCase()
  const tools = granted.filter((tool) => !wanted || tool.connection.kind === wanted || tool.connection.name.toLowerCase() === wanted)
  const lines = tools.map((tool) => `${tool.name} [${tool.connection.name}, ${tool.connection.id}]: ${tool.spec.description}`.slice(0, 140))
  if (lines.length) return lines.slice(0, 100).join('\n')
  return granted.length ? `No app named ${app}. Leave app out to list every tool.` : 'No tools: nobody has granted this agent a connection yet.'
}

async function messageTarget({ agentId, body }: { agentId: string; body: unknown }): Promise<{ object: 'message_target'; target: string; place: string }> {
  const parsed = MessageTarget.safeParse(body)
  if (!parsed.success) throw new HttpError(400, 'Send the channel id from get_self, and the chat if it has more than one.')
  const found = await channelService.postTarget({ agentId, ...parsed.data })
  log.info({ event: 'message.posted', agent: agentId, channel: found.channel })
  return { object: 'message_target', target: found.target, place: found.place }
}

async function telegramJoin({ agentId, body }: { agentId: string; body: unknown }) {
  const parsed = TelegramJoin.safeParse(body)
  if (!parsed.success) throw new HttpError(400, 'Send the invite code, the Telegram user and the chat.')
  const { code, ...person } = parsed.data
  return channelService.telegramJoin({ agentId, code, person })
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
