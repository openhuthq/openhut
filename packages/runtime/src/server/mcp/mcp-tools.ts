import * as z from 'zod/mini'
import { CreateAgent, CreateGrant, ListGrants, UpdateAgentFields } from '@openhut/common/agents/agent.ts'
import { UpdateAdminFields } from '@openhut/common/admin/admin.ts'
import { UpdateMemory } from '@openhut/common/agents/memory.ts'
import { ProviderId, UpdateProvider } from '@openhut/common/models/provider.ts'
import { ListChannels } from '@openhut/common/channels/channel.ts'
import { ListRoutines } from '@openhut/common/routines/routine.ts'
import { CreateConnection, CreateConnectionAuthorization, ListConnectionEvents, ListConnectionTools } from '@openhut/common/connections/connection.ts'
import { describeIssues } from '../platform/validation.ts'

const Id = z.object({ id: z.string().check(z.maxLength(60)) })
const Nothing = z.object({})

export const MCP_TOOLS = [
  tool({ name: 'list_agents', description: 'Every agent on this OpenHut, with its status.', input: Nothing, call: ({ api }) => api({ method: 'GET', url: '/api/agents' }) }),
  tool({ name: 'get_agent', description: 'One agent: its instructions, model and status.', input: Id, call: ({ api, input }) => api({ method: 'GET', url: `/api/agents/${input.id}` }) }),
  tool({ name: 'create_agent', description: 'Create an agent (stopped). You own it.', input: CreateAgent, call: ({ api, input }) => api({ method: 'POST', url: '/api/agents', payload: input }) }),
  tool({
    name: 'update_agent',
    description: 'Rename an agent, change its instructions, its model (a model key like claude:sonnet; it uses that one model for everything), switch its code execution or its web browser on or off (it restarts if running), or start or stop it with wanted.',
    input: z.object({ id: z.string(), ...UpdateAgentFields }),
    call: ({ api, input: { id, ...patch } }) => api({ method: 'PATCH', url: `/api/agents/${id}`, payload: patch }),
  }),
  tool({ name: 'revoke_agent_token', description: 'Revoke an agent\'s gateway token at once and give it a new one (it restarts if running). Use it when the token may have leaked.', input: Id, call: ({ api, input }) => api({ method: 'POST', url: `/api/agents/${input.id}/revoke-token` }) }),
  tool({ name: 'delete_agent', description: 'Delete an agent and its container.', input: Id, call: ({ api, input }) => api({ method: 'DELETE', url: `/api/agents/${input.id}` }) }),
  tool({ name: 'list_grants', description: 'Which connections each agent holds. Filter by agentId or connectionId.', input: ListGrants, call: ({ api, input }) => api({ method: 'GET', url: `/api/grants${query(input)}` }) }),
  tool({ name: 'create_grant', description: 'Let an agent use a connection. It takes effect on the agent\'s next call.', input: CreateGrant, call: ({ api, input }) => api({ method: 'POST', url: '/api/grants', payload: input }) }),
  tool({ name: 'delete_grant', description: 'Take a connection away from an agent. It takes effect on its next call.', input: Id, call: ({ api, input }) => api({ method: 'DELETE', url: `/api/grants/${input.id}` }) }),
  tool({ name: 'list_connections', description: 'Connections, and whether you can use each.', input: Nothing, call: ({ api }) => api({ method: 'GET', url: '/api/connections' }) }),
  tool({ name: 'get_connection', description: 'One connection.', input: Id, call: ({ api, input }) => api({ method: 'GET', url: `/api/connections/${input.id}` }) }),
  tool({
    name: 'create_connection',
    description: 'Add a connection that takes a key: Postgres (dsn), Convex (deployKey), Excalidraw (kind alone, it takes no key) or a custom MCP server (url, and an optional header like "Authorization: Bearer …"). Keys are sealed and never returned.',
    input: CreateConnection,
    call: ({ api, input }) => api({ method: 'POST', url: '/api/connections', payload: input }),
  }),
  tool({
    name: 'create_connection_authorization',
    description: 'Start a sign-in for PostHog, Linear, Gmail, Google Drive, Google Workspace or a custom MCP server (url), or reconnect one (connectionId). Give the person the authorizationUrl to open in their browser.',
    input: CreateConnectionAuthorization,
    call: ({ api, input }) => api({ method: 'POST', url: '/api/connection-authorizations', payload: input }),
  }),
  tool({ name: 'list_connection_tools', description: 'The tools a connection gives agents.', input: ListConnectionTools, call: ({ api, input }) => api({ method: 'GET', url: `/api/connection-tools${query(input)}` }) }),
  tool({ name: 'delete_connection', description: 'Delete a connection. Every agent loses it on its next call.', input: Id, call: ({ api, input }) => api({ method: 'DELETE', url: `/api/connections/${input.id}` }) }),
  tool({
    name: 'list_connection_events',
    description: 'Gateway calls, newest first: through one connection (connectionId) or by one agent (agentId), including refused ones.',
    input: ListConnectionEvents,
    call: ({ api, input }) => api({ method: 'GET', url: `/api/connection-events${query(input)}` }),
  }),
  tool({ name: 'list_routines', description: 'The routines an agent set up for itself: what it follows up on, when, and what it said last time.', input: ListRoutines, call: ({ api, input }) => api({ method: 'GET', url: `/api/routines${query(input)}` }) }),
  tool({ name: 'stop_routine', description: 'Stop one of an agent\'s routines for good. To change one, tell the agent instead.', input: Id, call: ({ api, input }) => api({ method: 'DELETE', url: `/api/routines/${input.id}` }) }),
  tool({ name: 'get_memory', description: 'What an agent remembers: notes for itself and what it knows about people, with how full each is.', input: Id, call: ({ api, input }) => api({ method: 'GET', url: `/api/memories/${input.id}` }) }),
  tool({
    name: 'update_memory',
    description: 'Replace an agent\'s notes or what it knows about people with this list of entries. Read get_memory first and send the whole list you want kept.',
    input: z.extend(UpdateMemory, { id: z.string() }),
    call: ({ api, input: { id, ...patch } }) => api({ method: 'PATCH', url: `/api/memories/${id}`, payload: patch }),
  }),
  tool({ name: 'list_channels', description: 'Agents\' Slack, WhatsApp and Telegram channels.', input: ListChannels, call: ({ api, input }) => api({ method: 'GET', url: `/api/channels${query(input)}` }) }),
  tool({ name: 'list_providers', description: 'The model providers (Claude and ChatGPT subscriptions, OpenRouter, OpenAI, xAI): which are connected on this computer and every model each offers, with whether it is switched on. An agent\'s model is a key like claude:sonnet or openrouter:google/gemini-3.5-flash.', input: Nothing, call: ({ api }) => api({ method: 'GET', url: '/api/providers' }) }),
  tool({
    name: 'update_provider',
    description: 'Connect OpenRouter, OpenAI or xAI by sending its API key (it is tested, sealed and never returned, and the models it offers are fetched), or switch models on or off with models: [{ id, on }]. Only models that are on can be given to agents.',
    input: z.extend(UpdateProvider, { id: ProviderId }),
    call: ({ api, input: { id, ...patch } }) => api({ method: 'PATCH', url: `/api/providers/${id}`, payload: patch }),
  }),
  tool({ name: 'refresh_provider', description: 'Ask a connected provider for its current models. Your switches stay as they are and new models come in switched off.', input: z.object({ id: ProviderId }), call: ({ api, input }) => api({ method: 'POST', url: `/api/providers/${input.id}/refresh` }) }),
  tool({ name: 'disconnect_provider', description: 'Remove a provider\'s key or sign-in from this computer. Agents using its models stop answering until you pick others.', input: z.object({ id: ProviderId }), call: ({ api, input }) => api({ method: 'DELETE', url: `/api/providers/${input.id}` }) }),
  tool({ name: 'get_seat_usage', description: 'How much of the Claude seat\'s plan limits are used (this session and this week), and what each agent spent this week at API prices.', input: Nothing, call: ({ api }) => api({ method: 'GET', url: '/api/admin/seat-usage' }) }),
  tool({ name: 'get_admin', description: 'The Claude seat, the server\'s health, its build and whether a newer release is out.', input: Nothing, call: ({ api }) => api({ method: 'GET', url: '/api/admin' }) }),
  tool({
    name: 'update_admin',
    description: 'Set the Claude seat token from `claude setup-token` (agents keep running; the gateway uses the new one on their next call).',
    input: z.object(UpdateAdminFields),
    call: ({ api, input }) => api({ method: 'PATCH', url: '/api/admin', payload: input }),
  }),
]

function tool<S extends z.ZodMiniObject>(spec: { name: string; description: string; input: S; call: (ctx: { api: Api; input: z.infer<S> }) => Promise<unknown> }): McpTool {
  return {
    name: spec.name,
    description: spec.description,
    inputSchema: z.toJSONSchema(spec.input, { io: 'input' }),
    run: ({ api, args }) => {
      const parsed = z.safeParse(spec.input, args)
      if (!parsed.success) throw new Error(`The input for ${spec.name} is not valid. ${describeIssues(parsed.error.issues)}`)
      return spec.call({ api, input: parsed.data })
    },
  }
}

function query(input: Record<string, unknown>): string {
  const params = new URLSearchParams(Object.entries(input).filter(([, value]) => value !== undefined).map(([key, value]) => [key, String(value)]))
  return params.size ? `?${params}` : ''
}

export type Api = (request: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; url: string; payload?: unknown }) => Promise<unknown>
type McpTool = { name: string; description: string; inputSchema: Record<string, unknown>; run: (ctx: { api: Api; args: unknown }) => Promise<unknown> }
