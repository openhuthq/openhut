import * as z from 'zod/mini'
import { CreateAgent, CreateGrant, ListGrants, UpdateAgentFields } from '@fastmonkey/common/agents/agent.ts'
import { UpdateAdminFields } from '@fastmonkey/common/admin/admin.ts'
import { ListChannels } from '@fastmonkey/common/channels/channel.ts'
import { CreateConnection, CreateConnectionAuthorization, ListConnectionEvents, ListConnectionTools, UpdateConnection } from '@fastmonkey/common/connections/connection.ts'
import { CreateInvite } from '@fastmonkey/common/team/team.ts'
import { describeIssues } from '../platform/validation.ts'

const Id = z.object({ id: z.string().check(z.maxLength(60)) })
const Nothing = z.object({})

export const MCP_TOOLS = [
  tool({ name: 'list_agents', description: 'Every agent on this Fast Monkey, with its status.', input: Nothing, call: ({ api }) => api({ method: 'GET', url: '/api/agents' }) }),
  tool({ name: 'get_agent', description: 'One agent: its instructions, model and status.', input: Id, call: ({ api, input }) => api({ method: 'GET', url: `/api/agents/${input.id}` }) }),
  tool({ name: 'create_agent', description: 'Create an agent (stopped). You own it.', input: CreateAgent, call: ({ api, input }) => api({ method: 'POST', url: '/api/agents', payload: input }) }),
  tool({
    name: 'update_agent',
    description: 'Rename an agent, change its instructions or model (it restarts if running), or start or stop it with wanted.',
    input: z.object({ id: z.string(), ...UpdateAgentFields }),
    call: ({ api, input: { id, ...patch } }) => api({ method: 'PATCH', url: `/api/agents/${id}`, payload: patch }),
  }),
  tool({ name: 'delete_agent', description: 'Delete an agent and its container.', input: Id, call: ({ api, input }) => api({ method: 'DELETE', url: `/api/agents/${input.id}` }) }),
  tool({ name: 'list_grants', description: 'Which connections each agent holds. Filter by agentId or connectionId.', input: ListGrants, call: ({ api, input }) => api({ method: 'GET', url: `/api/grants${query(input)}` }) }),
  tool({ name: 'create_grant', description: 'Let an agent use a connection. It takes effect on the agent\'s next call.', input: CreateGrant, call: ({ api, input }) => api({ method: 'POST', url: '/api/grants', payload: input }) }),
  tool({ name: 'delete_grant', description: 'Take a connection away from an agent. It takes effect on its next call.', input: Id, call: ({ api, input }) => api({ method: 'DELETE', url: `/api/grants/${input.id}` }) }),
  tool({ name: 'list_connections', description: 'Connections, and whether you can use each.', input: Nothing, call: ({ api }) => api({ method: 'GET', url: '/api/connections' }) }),
  tool({ name: 'get_connection', description: 'One connection.', input: Id, call: ({ api, input }) => api({ method: 'GET', url: `/api/connections/${input.id}` }) }),
  tool({
    name: 'create_connection',
    description: 'Add a connection that takes a key: Postgres (dsn), Convex (deployKey) or a custom MCP server (url, and an optional header like "Authorization: Bearer …"). Keys are sealed and never returned.',
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
  tool({
    name: 'update_connection',
    description: 'Share a connection you own with everyone on the team, or stop sharing it.',
    input: z.extend(UpdateConnection, { id: z.string() }),
    call: ({ api, input: { id, everyone } }) => api({ method: 'PATCH', url: `/api/connections/${id}`, payload: { everyone } }),
  }),
  tool({ name: 'delete_connection', description: 'Delete a connection. Every agent loses it on its next call.', input: Id, call: ({ api, input }) => api({ method: 'DELETE', url: `/api/connections/${input.id}` }) }),
  tool({
    name: 'list_connection_events',
    description: 'Gateway calls, newest first: through one connection (connectionId) or by one agent (agentId), including refused ones.',
    input: ListConnectionEvents,
    call: ({ api, input }) => api({ method: 'GET', url: `/api/connection-events${query(input)}` }),
  }),
  tool({ name: 'list_channels', description: 'Agents\' Slack, WhatsApp and Telegram channels.', input: ListChannels, call: ({ api, input }) => api({ method: 'GET', url: `/api/channels${query(input)}` }) }),
  tool({ name: 'list_people', description: 'People on the team and their roles.', input: Nothing, call: ({ api }) => api({ method: 'GET', url: '/api/people' }) }),
  tool({ name: 'delete_person', description: 'Remove a person (not the owner): they can\'t sign in, their apps are disconnected and their agents stop.', input: Id, call: ({ api, input }) => api({ method: 'DELETE', url: `/api/people/${input.id}` }) }),
  tool({ name: 'list_invites', description: 'Invite links not used yet (owner or admin).', input: Nothing, call: ({ api }) => api({ method: 'GET', url: '/api/invites' }) }),
  tool({ name: 'create_invite', description: 'Make a one-time invite link (owner or admin). It works once and for 7 days.', input: CreateInvite, call: ({ api, input }) => api({ method: 'POST', url: '/api/invites', payload: input }) }),
  tool({ name: 'delete_invite', description: 'Revoke an invite link that hasn\'t been used.', input: Id, call: ({ api, input }) => api({ method: 'DELETE', url: `/api/invites/${input.id}` }) }),
  tool({ name: 'get_admin', description: 'The Claude seat, the public URL, the server\'s health, its build and whether a newer release is out.', input: Nothing, call: ({ api }) => api({ method: 'GET', url: '/api/admin' }) }),
  tool({
    name: 'update_admin',
    description: 'Set the Claude seat token from `claude setup-token` (every agent restarts with it) or the public URL. Owner or admin.',
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
