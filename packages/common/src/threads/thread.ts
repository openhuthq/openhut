import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const ChatMessage = z.looseObject({
  id: z.string().check(z.maxLength(100)),
  role: z.enum(['user', 'assistant']),
  parts: z.array(z.looseObject({ type: z.string() })).check(z.maxLength(500)),
})
export type ChatMessage = z.infer<typeof ChatMessage>

export const Thread = z.object({
  id: z.string(),
  object: z.literal('thread'),
  agentId: z.string(),
  title: z.string(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Thread = z.infer<typeof Thread>

export const ThreadWithMessages = z.extend(Thread, { messages: z.array(ChatMessage) })
export type ThreadWithMessages = z.infer<typeof ThreadWithMessages>

export const CreateThread = z.object({
  agentId: z.string().check(z.maxLength(40)),
})
export type CreateThread = z.infer<typeof CreateThread>

export const SendChat = z.object({
  trigger: z.enum(['submit-message', 'regenerate-message']),
  message: z.optional(ChatMessage),
})
export type SendChat = z.infer<typeof SendChat>

export const ChatCall = z.object({
  tool: z.string(),
  connectionName: z.nullable(z.string()),
  outcome: z.enum(['allowed', 'denied', 'failed']),
  reason: z.string(),
  ms: z.number(),
})
export type ChatCall = z.infer<typeof ChatCall>

export const ToolProgress = z.looseObject({ tool: z.optional(z.string()), name: z.optional(z.string()), label: z.optional(z.string()) })
export type ToolProgress = z.infer<typeof ToolProgress>
