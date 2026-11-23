import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const ChangeAction = z.enum(['update_self', 'add_channel', 'update_channel', 'remove_channel', 'request_connection'])
export type ChangeAction = z.infer<typeof ChangeAction>

export const ChangeRequest = z.object({
  id: z.string(),
  object: z.literal('change_request'),
  agentId: z.string(),
  action: ChangeAction,
  input: z.record(z.string(), z.unknown()),
  summary: z.string(),
  why: z.string(),
  status: z.enum(['pending', 'approved', 'denied']),
  note: z.nullable(z.string()),
  createdAt: Timestamp,
  decidedAt: z.nullable(Timestamp),
})
export type ChangeRequest = z.infer<typeof ChangeRequest>

export const ListChangeRequests = z.object({ agentId: z.string().check(z.maxLength(40)) })
export type ListChangeRequests = z.infer<typeof ListChangeRequests>

export const ApproveChangeRequest = z.object({ input: z.optional(z.record(z.string(), z.unknown())) })
export type ApproveChangeRequest = z.infer<typeof ApproveChangeRequest>

export const DenyChangeRequest = z.object({ note: z.optional(z.string().check(z.maxLength(500))) })
export type DenyChangeRequest = z.infer<typeof DenyChangeRequest>
