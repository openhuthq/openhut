import * as z from 'zod/mini'
import { ListQuery, Timestamp } from '../api.ts'

export const KEYED_KINDS = ['postgres', 'convex', 'excalidraw', 'mcp'] as const
export const GOOGLE_KINDS = ['gmail', 'drive', 'google', 'google_chat', 'google_contacts', 'google_search'] as const
export const SIGN_IN_KINDS = ['posthog', 'linear', 'github', ...GOOGLE_KINDS, 'mcp'] as const
export const ConnectionKind = z.enum(['postgres', 'convex', 'posthog', 'linear', 'github', ...GOOGLE_KINDS, 'excalidraw', 'mcp'])
export type ConnectionKind = z.infer<typeof ConnectionKind>

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
  everyone: z.boolean(),
  usable: z.boolean(),
  canDelete: z.boolean(),
  agents: z.number(),
  status: ConnectionStatus,
  lastSuccessAt: z.nullable(Timestamp),
  keyHere: z._default(z.boolean(), true),
  changedBy: z._default(z.nullable(z.string()), null),
  createdAt: Timestamp,
})
export type Connection = z.infer<typeof Connection>

export const ConnectionTool = z.object({
  object: z.literal('connection_tool'),
  name: z.string(),
  description: z.string(),
})
export type ConnectionTool = z.infer<typeof ConnectionTool>

export const ListConnectionTools = z.object({ connectionId: z.string().check(z.maxLength(40)) })
export type ListConnectionTools = z.infer<typeof ListConnectionTools>

const Outcome = z.enum(['allowed', 'denied', 'failed'])
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
  outcome: Outcome,
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

export const UpdateConnection = z.object({ everyone: z.boolean() })
export type UpdateConnection = z.infer<typeof UpdateConnection>

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
})
export type ConnectionAuthorization = z.infer<typeof ConnectionAuthorization>
