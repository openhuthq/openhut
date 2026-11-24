import * as z from 'zod/mini'
import { Base64, DeviceKey } from '../cloud.ts'
import { WorkspaceId } from './identity.ts'

export const HELLO_MS = 10_000
export const FORWARDED = ['presence', 'beat'] as const

export const ClientEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), token: z.string().check(z.maxLength(4096)) }),
  z.object({ type: z.enum(FORWARDED), workspace: WorkspaceId, body: Base64.check(z.maxLength(2048)) }),
])
export type ClientEvent = z.infer<typeof ClientEvent>

export const Notice = z.object({ object: z.string(), id: z.string(), ver: z.number(), workspace: WorkspaceId, deleted: z.optional(z.boolean()), why: z.optional(z.enum(['mismatch', 'not-me'])) })
export type Notice = z.infer<typeof Notice>

export const Forwarded = z.object({ object: z.enum(FORWARDED), workspace: WorkspaceId, from: DeviceKey, body: Base64 })
export type Forwarded = z.infer<typeof Forwarded>

export const Ready = z.object({ object: z.literal('ready'), workspaces: z.array(WorkspaceId) })
export type Ready = z.infer<typeof Ready>
