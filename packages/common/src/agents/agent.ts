import * as z from 'zod/mini'
import { Timestamp, atLeastOneField } from '../api.ts'

export const ModelId = z.enum(['opus', 'sonnet', 'haiku'])
export type ModelId = z.infer<typeof ModelId>

export const MODELS = [
  { id: 'opus', label: 'Opus 5.5', blurb: 'Most capable, for hard problems' },
  { id: 'sonnet', label: 'Sonnet 5.5', blurb: 'Fast and capable: the default' },
  { id: 'haiku', label: 'Haiku 5.5', blurb: 'Fastest, for quick replies' },
] as const satisfies readonly { id: ModelId; label: string; blurb: string }[]

export const AgentStatus = z.enum(['running', 'stopped', 'missing'])
export type AgentStatus = z.infer<typeof AgentStatus>

export const AgentHealth = z.enum(['answering', 'starting', 'not_answering', 'no_seat'])
export type AgentHealth = z.infer<typeof AgentHealth>

export const Wanted = z.enum(['running', 'stopped'])
export type Wanted = z.infer<typeof Wanted>

export const Agent = z.object({
  id: z.string(),
  object: z.literal('agent'),
  name: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  model: ModelId,
  wanted: Wanted,
  status: AgentStatus,
  health: z.nullable(AgentHealth),
  healthDetail: z.string(),
  summary: z.string(),
  net: z.number(),
  instructions: z.string(),
  codeExecution: z.boolean(),
  canEdit: z.boolean(),
  createdAt: Timestamp,
})
export type Agent = z.infer<typeof Agent>

const AgentName = z.string().check(z.minLength(1), z.maxLength(40))

export const CreateAgent = z.object({
  name: AgentName,
  instructions: z.optional(z.string().check(z.maxLength(20_000))),
})
export type CreateAgent = z.infer<typeof CreateAgent>

export const UpdateAgentFields = {
  name: z.optional(AgentName),
  instructions: z.optional(z.string().check(z.maxLength(20_000))),
  model: z.optional(ModelId),
  wanted: z.optional(Wanted),
  codeExecution: z.optional(z.boolean()),
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

