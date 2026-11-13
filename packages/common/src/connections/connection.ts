import * as z from 'zod/mini'
import { ListQuery, Timestamp } from '../api.ts'

export const ConnectionStatus = z.enum(['connected', 'failing', 'no_calls'])
export type ConnectionStatus = z.infer<typeof ConnectionStatus>

export const Connection = z.object({
  id: z.string(),
  object: z.literal('connection'),
  kind: z.literal('postgres'),
  name: z.string(),
  ownerId: z.string(),
  ownerName: z.string(),
  everyone: z.boolean(),
  usable: z.boolean(),
  canDelete: z.boolean(),
  agents: z.number(),
  status: ConnectionStatus,
  lastSuccessAt: z.nullable(Timestamp),
  createdAt: Timestamp,
})
export type Connection = z.infer<typeof Connection>

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

export const CreateConnection = z.object({
  name: z.string().check(z.minLength(1), z.maxLength(60)),
  dsn: z.string().check(z.minLength(1), z.maxLength(2000)),
})
export type CreateConnection = z.infer<typeof CreateConnection>

export const UpdateConnection = z.object({ everyone: z.boolean() })
export type UpdateConnection = z.infer<typeof UpdateConnection>
