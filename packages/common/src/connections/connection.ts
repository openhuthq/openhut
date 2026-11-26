import * as z from 'zod/mini'
import { ListQuery, Timestamp } from '../api.ts'

export const KEYED_KINDS = ['postgres', 'convex', 'excalidraw', 'mcp'] as const
export const GOOGLE_KINDS = ['gmail', 'drive', 'google', 'google_chat', 'google_contacts', 'google_search'] as const
export const SIGN_IN_KINDS = ['posthog', 'linear', 'github', ...GOOGLE_KINDS, 'mcp'] as const
export const ConnectionKind = z.enum(['postgres', 'convex', 'posthog', 'linear', 'github', ...GOOGLE_KINDS, 'excalidraw', 'mcp'])
export type ConnectionKind = z.infer<typeof ConnectionKind>
export const CONNECTION_TITLES: Record<ConnectionKind, string> = {
  postgres: 'Postgres', convex: 'Convex', posthog: 'PostHog', linear: 'Linear', github: 'GitHub', gmail: 'Gmail', drive: 'Google Drive',
  google: 'Google Workspace', google_chat: 'Google Chat', google_contacts: 'Google Contacts', google_search: 'Google Search', excalidraw: 'Excalidraw', mcp: 'MCP server',
}

export const ConnectionStatus = z.enum(['connected', 'failing', 'no_calls'])
export type ConnectionStatus = z.infer<typeof ConnectionStatus>

export const Connection = z.object({
  id: z.string(),
  object: z.literal('connection'),
  kind: ConnectionKind,
  name: z.string(),
  account: z.string(),
  signIn: z.boolean(),
  ownerId: z.string(),
  ownerName: z.string(),
  canDelete: z.boolean(),
  agents: z.number(),
  status: ConnectionStatus,
  lastSuccessAt: z.nullable(Timestamp),
  createdAt: Timestamp,
})
export type Connection = z.infer<typeof Connection>

export const ConnectionTool = z.object({
  object: z.literal('connection_tool'),
  name: z.string(),
  description: z.string(),
})
export type ConnectionTool = z.infer<typeof ConnectionTool>

export const Permission = z.enum(['allow', 'ask', 'deny'])
export type Permission = z.infer<typeof Permission>

export const ToolGroup = z.enum(['read', 'create', 'update', 'delete', 'other'])
export type ToolGroup = z.infer<typeof ToolGroup>

export const AgentTool = z.object({
  object: z.literal('agent_tool'),
  agentId: z.string(),
  connectionId: z.string(),
  name: z.string(),
  description: z.string(),
  group: ToolGroup,
  permission: Permission,
  isDefault: z.boolean(),
})
export type AgentTool = z.infer<typeof AgentTool>

export const ListAgentTools = z.object({ agentId: z.string().check(z.maxLength(40)), connectionId: z.string().check(z.maxLength(40)) })
export type ListAgentTools = z.infer<typeof ListAgentTools>

export const UpdateAgentTools = z.extend(ListAgentTools, {
  tools: z.array(z.string().check(z.maxLength(200))).check(z.minLength(1), z.maxLength(500)),
  permission: Permission,
})
export type UpdateAgentTools = z.infer<typeof UpdateAgentTools>

const HttpsUrl = z.url({ protocol: /^https$/ }).check(z.maxLength(500))

export const ProposedGroup = z.object({ group: ToolGroup, label: z.string().check(z.minLength(1), z.maxLength(80)), permission: Permission })
export type ProposedGroup = z.infer<typeof ProposedGroup>

export const ProposedConnection = z.object({
  name: z.string().check(z.minLength(1), z.maxLength(60)),
  line: z.optional(z.string().check(z.maxLength(120))),
  url: HttpsUrl,
  token: z.object({
    label: z.string().check(z.minLength(1), z.maxLength(60)),
    guide: z.string().check(z.minLength(1), z.maxLength(300)),
    link: HttpsUrl,
    scopes: z.optional(z.array(z.string().check(z.maxLength(100))).check(z.maxLength(30))),
  }),
  groups: z.array(ProposedGroup).check(z.minLength(1), z.maxLength(5), z.refine((groups) => new Set(groups.map((each) => each.group)).size === groups.length, 'Give each kind of tool once.')),
})
export type ProposedConnection = z.infer<typeof ProposedConnection>

export const ListConnectionTools = z.object({ connectionId: z.string().check(z.maxLength(40)) })
export type ListConnectionTools = z.infer<typeof ListConnectionTools>

export const CallOutcome = z.enum(['allowed', 'asked', 'denied', 'failed'])
const EventCursor = z.string().check(z.regex(/^\d{1,18}$/, 'Pass the id of an event from the list as the cursor.'))

export const ConnectionEvent = z.object({
  id: z.string(),
  object: z.literal('connection_event'),
  at: Timestamp,
  connectionId: z.nullable(z.string()),
  agentId: z.string(),
  agentName: z.string(),
  tool: z.string(),
  reason: z.string(),
  outcome: CallOutcome,
  approvedBy: z.nullable(z.string()),
  ms: z.number(),
})
export type ConnectionEvent = z.infer<typeof ConnectionEvent>

export const ListConnectionEvents = z.extend(ListQuery, {
  connectionId: z.optional(z.string().check(z.maxLength(40))),
  agentId: z.optional(z.string().check(z.maxLength(40))),
  startingAfter: z.optional(EventCursor),
})
export type ListConnectionEvents = z.infer<typeof ListConnectionEvents>

const Name = z.string().check(z.minLength(1), z.maxLength(60))
const McpUrl = z.url({ protocol: /^https?$/ }).check(z.maxLength(500))

export const CreateConnection = z.object({
  kind: z._default(z.enum(KEYED_KINDS), 'postgres'),
  name: Name,
  dsn: z.optional(z.string().check(z.minLength(1), z.maxLength(2000))),
  deployKey: z.optional(z.string().check(z.minLength(1), z.maxLength(2000))),
  url: z.optional(McpUrl),
  header: z.optional(z.string().check(z.maxLength(4000))),
})
export type CreateConnection = z.input<typeof CreateConnection>

export const CreateConnectionAuthorization = z.object({
  kind: z.optional(z.enum(SIGN_IN_KINDS)),
  name: z.optional(Name),
  url: z.optional(McpUrl),
  organization: z.optional(z.string().check(z.regex(/^[A-Za-z0-9-]{1,39}$/, 'Write the organization as it appears in its GitHub URL.'))),
  connectionId: z.optional(z.string().check(z.maxLength(40))),
})
export type CreateConnectionAuthorization = z.infer<typeof CreateConnectionAuthorization>

export const ConnectionAuthorization = z.object({
  object: z.literal('connection_authorization'),
  kind: z.enum(SIGN_IN_KINDS),
  authorizationUrl: z.string(),
  manifest: z.optional(z.string()),
  id: z._default(z.string(), ''),
  status: z._default(z.enum(['pending', 'done', 'failed']), 'pending'),
  connectionId: z.optional(z.string()),
  error: z.optional(z.string()),
})
export type ConnectionAuthorization = z.infer<typeof ConnectionAuthorization>
