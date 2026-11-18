import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const Invitation = z.object({
  object: z.literal('invitation'),
  id: z.string(),
  status: z.enum(['waiting', 'joined', 'accepted', 'declined', 'expired']),
  expiresAt: Timestamp,
  code: z.optional(z.string()),
  device: z.nullable(z.object({ name: z.string(), kind: z.enum(['client', 'computer']), key: z.string() })),
  digits: z.nullable(z.string()),
})
export type Invitation = z.infer<typeof Invitation>
