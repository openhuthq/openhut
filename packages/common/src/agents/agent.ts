import * as z from 'zod/mini'
import { Timestamp, atLeastOneField } from '../api.ts'
import { CreateExport } from '../admin/admin.ts'
import { LEGACY_MODELS, ModelKey } from '../models/provider.ts'

export const AgentStatus = z.enum(['running', 'stopped', 'missing'])
export type AgentStatus = z.infer<typeof AgentStatus>

export const AgentHealth = z.enum(['answering', 'starting', 'not_answering', 'no_seat'])
export type AgentHealth = z.infer<typeof AgentHealth>

export const Wanted = z.enum(['running', 'stopped'])
export type Wanted = z.infer<typeof Wanted>

export const HELPER_TASKS = [
  { slot: 'compress', label: 'Summarising long chats', hint: 'Shrinks old messages when a chat gets long.' },
  { slot: 'title', label: 'Naming chats', hint: 'Gives each new chat a short title.' },
  { slot: 'review', label: 'Learning from chats', hint: 'Reads a chat afterwards to save skills and memory.' },
] as const

export type HelperSlot = (typeof HELPER_TASKS)[number]['slot']

export const HelperModels = z.object({ compress: z.nullable(ModelKey), title: z.nullable(ModelKey), review: z.nullable(ModelKey) })
export type HelperModels = z.infer<typeof HelperModels>

export const Agent = z.object({
  id: z.string(),
  object: z.literal('agent'),
  name: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  model: z.pipe(z.pipe(z.string(), z.transform((key) => LEGACY_MODELS[key] ?? key)), ModelKey),
  helperModels: z._default(HelperModels, { compress: null, title: null, review: null }),
  wanted: Wanted,
  status: AgentStatus,
  health: z.nullable(AgentHealth),
  healthDetail: z.string(),
  summary: z.string(),
  net: z.number(),
  instructions: z.string(),
  codeExecution: z.boolean(),
  browser: z.boolean(),
  canEdit: z.boolean(),
  createdAt: Timestamp,
})
export type Agent = z.infer<typeof Agent>

const AgentName = z.string().check(z.minLength(1), z.maxLength(40))

const HelperChoices = z.object({ compress: z.optional(z.nullable(ModelKey)), title: z.optional(z.nullable(ModelKey)), review: z.optional(z.nullable(ModelKey)) })

export const CreateAgent = z.object({
  name: AgentName,
  instructions: z.optional(z.string().check(z.maxLength(20_000))),
  model: z.optional(ModelKey),
  helperModels: z.optional(HelperChoices),
})
export type CreateAgent = z.infer<typeof CreateAgent>

export const UpdateAgentFields = {
  name: z.optional(AgentName),
  instructions: z.optional(z.string().check(z.maxLength(20_000))),
  model: z.optional(ModelKey),
  helperModels: z.optional(HelperChoices),
  wanted: z.optional(Wanted),
  codeExecution: z.optional(z.boolean()),
  browser: z.optional(z.boolean()),
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


export const MAX_SEALED_AGENT = 256 << 20

export const ExportAgent = z.pick(CreateExport, { publicKey: true })
export type ExportAgent = z.infer<typeof ExportAgent>

export const ImportAgent = z.object({ sealed: z.string().check(z.maxLength(MAX_SEALED_AGENT)) })
export type ImportAgent = z.infer<typeof ImportAgent>

export const AgentImport = z.object({
  object: z.literal('agent_import'),
  agent: Agent,
  ungranted: z.array(z.string()),
})
export type AgentImport = z.infer<typeof AgentImport>
