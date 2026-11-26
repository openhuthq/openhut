import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const Subagent = z.object({
  id: z.string(),
  object: z.literal('subagent'),
  title: z.string(),
  status: z.enum(['working', 'done', 'failed']),
  startedAt: Timestamp,
})
export type Subagent = z.infer<typeof Subagent>
