import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const ROUTINE_NAME_MAX = 80
export const ROUTINE_PLAN_MAX = 2000

export const RunStatus = z.enum(['open', 'told', 'quiet', 'failed'])
export type RunStatus = z.infer<typeof RunStatus>

export const Routine = z.object({
  id: z.string(),
  object: z.literal('routine'),
  agentId: z.string(),
  name: z.string(),
  plan: z.string(),
  at: z.nullable(Timestamp),
  cron: z.nullable(z.string()),
  until: z.nullable(Timestamp),
  platform: z.string(),
  target: z.string(),
  place: z.string(),
  nextRunAt: z.nullable(Timestamp),
  stopped: z.nullable(z.string()),
  last: z.nullable(z.object({ status: RunStatus, at: Timestamp, text: z.nullable(z.string()) })),
  createdAt: Timestamp,
})
export type Routine = z.infer<typeof Routine>

export const ListRoutines = z.object({ agentId: z.string() })

export const UpdateRoutine = z.object({ target: z.optional(z.string().check(z.maxLength(40))), until: z.optional(z.nullable(z.string().check(z.maxLength(40)))) })
export type UpdateRoutine = z.infer<typeof UpdateRoutine>
export type ListRoutines = z.infer<typeof ListRoutines>

export const RoutineRecord = z.object({
  name: z.string(),
  plan: z.string(),
  at: z.nullable(z.string()),
  cron: z.nullable(z.string()),
  until: z.nullable(z.string()),
  origin: z.string(),
  createdAt: z.string(),
})
export type RoutineRecord = z.infer<typeof RoutineRecord>
