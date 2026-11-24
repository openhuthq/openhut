import * as z from 'zod/mini'
import { Timestamp, atLeastOneField } from '../api.ts'
import { ModelKey } from '../models/provider.ts'

export const AgentStatus = z.enum(['running', 'stopped', 'missing'])
export type AgentStatus = z.infer<typeof AgentStatus>

export const AgentHealth = z.enum(['answering', 'starting', 'not_answering', 'no_seat', 'setup_failed'])
export type AgentHealth = z.infer<typeof AgentHealth>

export const Wanted = z.enum(['running', 'stopped'])
export type Wanted = z.infer<typeof Wanted>

export const Agent = z.object({
  id: z.string(),
  object: z.literal('agent'),
  name: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  model: ModelKey,
  modelName: z._default(z.nullable(z.string()), null),
  wanted: Wanted,
  status: AgentStatus,
  health: z.nullable(AgentHealth),
  healthDetail: z.string(),
  summary: z.string(),
  net: z.number(),
  instructions: z.string(),
  codeExecution: z.boolean(),
  browser: z.boolean(),
  face: z._default(z.nullable(z.string()), null),
  canEdit: z.boolean(),
  runsHere: z._default(z.boolean(), true),
  runsNowhere: z._default(z.boolean(), false),
  runsOnName: z._default(z.nullable(z.string()), null),
  runsOnServer: z._default(z.boolean(), false),
  runsOn: z._default(z.nullable(z.string()), null),
  changedBy: z._default(z.nullable(z.string()), null),
  workspace: z._default(z.nullable(z.string()), null),
  shared: z._default(z.boolean(), false),
  people: z._default(z.array(z.string()), []),
  sidebars: z._default(z.array(z.string()), []),
  inSidebar: z._default(z.boolean(), true),
  owner: z._default(z.nullable(z.string()), null),
  canManage: z._default(z.boolean(), true),
  createdAt: Timestamp,
})
export type Agent = z.infer<typeof Agent>

const AgentName = z.string().check(z.minLength(1), z.maxLength(40))
const Face = z.string().check(z.maxLength(60_000))
const Emails = z.array(z.email().check(z.maxLength(320), z.toLowerCase())).check(z.maxLength(200))

export const CreateAgent = z.object({
  name: AgentName,
  instructions: z.optional(z.string().check(z.maxLength(20_000))),
  model: z.optional(ModelKey),
  face: z.optional(Face),
  workspace: z.optional(z.string().check(z.regex(/^[A-Za-z0-9_-]{8,64}$/))),
  shared: z.optional(z.boolean()),
  people: z.optional(Emails),
  sidebars: z.optional(Emails),
})
export type CreateAgent = z.infer<typeof CreateAgent>

export const UpdateAgentFields = {
  name: z.optional(AgentName),
  instructions: z.optional(z.string().check(z.maxLength(20_000))),
  model: z.optional(ModelKey),
  wanted: z.optional(Wanted),
  codeExecution: z.optional(z.boolean()),
  browser: z.optional(z.boolean()),
  face: z.optional(Face),
  runsHere: z.optional(z.literal(true)),
  runsOn: z.optional(z.string().check(z.minLength(1), z.maxLength(200))),
  shared: z.optional(z.boolean()),
  people: z.optional(Emails),
  sidebars: z.optional(Emails),
}
export const UpdateAgent = z.object(UpdateAgentFields).check(atLeastOneField)
export type UpdateAgent = z.infer<typeof UpdateAgent>

export const Grant = z.object({
  id: z.string(),
  object: z.literal('grant'),
  agentId: z.string(),
  connectionId: z.string(),
  createdAt: Timestamp,
})
export type Grant = z.infer<typeof Grant>

export const CreateGrant = z.object({ agentId: z.string().check(z.maxLength(40)), connectionId: z.string().check(z.maxLength(40)) })
export type CreateGrant = z.infer<typeof CreateGrant>

export const ListGrants = z.object({ agentId: z.optional(z.string()), connectionId: z.optional(z.string()) })
export type ListGrants = z.infer<typeof ListGrants>


export const AgentRecord = z.object({
  name: AgentName,
  instructions: z.string().check(z.maxLength(20_000)),
  face: z._default(z.nullable(Face), null),
  wanted: Wanted,
  createdAt: z.string(),
})
export type AgentRecord = z.infer<typeof AgentRecord>

export const ControlRecord = z.object({
  runsOn: z.string(),
  model: ModelKey,
  codeExecution: z.boolean(),
  browser: z.boolean(),
  grants: z.array(z.object({ connection: z.string(), at: z.string() })),
  people: z._default(z.array(z.string()), []),
  sidebars: z._default(z.array(z.string()), []),
})
export type ControlRecord = z.infer<typeof ControlRecord>

// Who can open an agent: everyone on its team when shared, otherwise its owner and the people picked.
// ponytail: a runtime older than this one that rewrites the control record drops people/sidebars (zod strips them), so "only people I pick" falls back to "only you", never wider.
export type Access = { owner: string; shared: boolean; people: readonly string[]; sidebars: readonly string[] }

export function canUse(access: Access, email: string): boolean {
  return email === access.owner || access.shared || access.people.includes(email)
}

// Whose sidebar it sits in: picked people, or for a team agent the people added to sidebars (nobody listed means everyone).
export function inSidebar(access: Access, email: string): boolean {
  if (email === access.owner) return true
  if (!access.shared) return access.people.includes(email)
  return access.sidebars.length === 0 || access.sidebars.includes(email)
}
