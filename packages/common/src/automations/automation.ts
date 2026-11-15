import * as z from 'zod/mini'
import { Timestamp, atLeastOneField } from '../api.ts'

export const AUTOMATION_INSTRUCTIONS_MAX = 5000
export const WEBHOOK_BODY_MAX = 64 * 1024

export const Every = z.enum(['hourly', 'daily', 'weekdays', 'weekly'])
export type Every = z.infer<typeof Every>

export const Schedule = z.object({
  every: Every,
  at: z.string().check(z.regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:00.')),
  day: z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(6))),
})
export type Schedule = z.infer<typeof Schedule>

export const SendTargetId = z.string().check(z.regex(/^[a-z]+:[\w@.#:+-]{1,200}$/, 'Pick a place to post from the list.'))

export const RunStatus = z.enum(['running', 'done', 'quiet', 'skipped', 'failed'])
export type RunStatus = z.infer<typeof RunStatus>

export const AutomationRun = z.object({
  id: z.string(),
  object: z.literal('automation_run'),
  automationId: z.string(),
  trigger: z.enum(['schedule', 'webhook', 'manual']),
  status: RunStatus,
  answer: z.nullable(z.string()),
  error: z.nullable(z.string()),
  startedAt: Timestamp,
  ms: z.nullable(z.number()),
})
export type AutomationRun = z.infer<typeof AutomationRun>

export const Automation = z.object({
  id: z.string(),
  object: z.literal('automation'),
  agentId: z.string(),
  name: z.string(),
  instructions: z.string(),
  trigger: z.enum(['schedule', 'webhook']),
  schedule: z.nullable(Schedule),
  webhookUrl: z.nullable(z.string()),
  webhookSecret: z.optional(z.string()),
  postTo: z.nullable(z.string()),
  enabled: z.boolean(),
  nextRunAt: z.nullable(Timestamp),
  lastRun: z.nullable(z.object({ status: RunStatus, startedAt: Timestamp })),
  createdAt: Timestamp,
})
export type Automation = z.infer<typeof Automation>

const Name = z.string().check(z.trim(), z.minLength(1, 'Give it a name.'), z.maxLength(80))
const Instructions = z.string().check(z.trim(), z.minLength(1, 'Say what the agent should do.'), z.maxLength(AUTOMATION_INSTRUCTIONS_MAX))

export const CreateAutomation = z.object({
  agentId: z.string(),
  name: Name,
  instructions: Instructions,
  schedule: z.optional(Schedule),
  webhook: z.optional(z.literal(true)),
  postTo: z.optional(z.nullable(SendTargetId)),
  enabled: z.optional(z.boolean()),
}).check(z.refine((body) => !!body.schedule !== !!body.webhook, 'Choose a schedule or a webhook.'))
export type CreateAutomation = z.infer<typeof CreateAutomation>

export const UpdateAutomationFields = {
  name: z.optional(Name),
  instructions: z.optional(Instructions),
  schedule: z.optional(Schedule),
  postTo: z.optional(z.nullable(SendTargetId)),
  enabled: z.optional(z.boolean()),
}
export const UpdateAutomation = z.object(UpdateAutomationFields).check(atLeastOneField)
export type UpdateAutomation = z.infer<typeof UpdateAutomation>

export const ListAutomations = z.object({ agentId: z.string() })
export type ListAutomations = z.infer<typeof ListAutomations>

export const CreateAutomationRun = z.object({ automationId: z.string() })
export type CreateAutomationRun = z.infer<typeof CreateAutomationRun>

export const ListAutomationRuns = z.object({ automationId: z.string() })
export type ListAutomationRuns = z.infer<typeof ListAutomationRuns>

export const SendTarget = z.object({ id: z.string(), object: z.literal('send_target'), platform: z.string(), name: z.string(), type: z.string() })
export type SendTarget = z.infer<typeof SendTarget>

export const ListSendTargets = z.object({ agentId: z.string() })
export type ListSendTargets = z.infer<typeof ListSendTargets>
