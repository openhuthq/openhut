import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'
import { Place } from '../channels/channel.ts'

export const ChatMessage = z.looseObject({
  id: z.string().check(z.maxLength(100)),
  role: z.enum(['user', 'assistant']),
  parts: z.array(z.looseObject({ type: z.string() })).check(z.maxLength(500)),
})
export type ChatMessage = z.infer<typeof ChatMessage>

export const ThreadOrigin = z.object({
  platform: z.enum(['app', 'discord', 'webhook', 'routine']),
  label: z.string(),
  url: z.optional(z.string()),
})
export type ThreadOrigin = z.infer<typeof ThreadOrigin>

export const Thread = z.object({
  id: z.string(),
  object: z.literal('thread'),
  agentId: z.string(),
  title: z.string(),
  origin: ThreadOrigin,
  place: z.nullable(Place),
  readOnly: z.boolean(),
  continueUrl: z.nullable(z.string()),
  waiting: z.boolean(),
  activeTurn: z.nullable(z.string()),
  preview: z.string(),
  archivedAt: z.nullable(Timestamp),
  createdAt: Timestamp,
  updatedAt: Timestamp,
})
export type Thread = z.infer<typeof Thread>

export const ThreadWithMessages = z.extend(Thread, { messages: z.array(ChatMessage) })
export type ThreadWithMessages = z.infer<typeof ThreadWithMessages>

export const MessageValue = z.object({ message: ChatMessage, session: z.optional(z.string().check(z.maxLength(120))) })
export type MessageValue = z.infer<typeof MessageValue>

export const SendChat = z.object({
  trigger: z.enum(['submit-message', 'regenerate-message']),
  message: z.optional(ChatMessage),
})
export type SendChat = z.infer<typeof SendChat>

export const ChatCall = z.object({
  tool: z.string(),
  connectionName: z.nullable(z.string()),
  outcome: z.enum(['allowed', 'asked', 'denied', 'failed']),
  reason: z.string(),
  ms: z.number(),
})
export type ChatCall = z.infer<typeof ChatCall>

export const ToolCall = z.object({
  id: z.string(),
  tool: z.string(),
  app: z.nullable(z.string()),
  connectionId: z.optional(z.string()),
  kind: z.enum(['read', 'change', 'delete', 'other']),
  label: z.string(),
  past: z.string(),
  input: z.optional(z.string()),
  output: z.optional(z.string()),
  error: z.optional(z.string()),
  ms: z.number(),
  status: z.enum(['running', 'done', 'failed', 'blocked', 'asked']),
})
export type ToolCall = z.infer<typeof ToolCall>

export const Work = z.object({ calls: z.array(ToolCall), ms: z.number(), error: z.optional(z.string()) })
export type Work = z.infer<typeof Work>

export const WAITING = 'Waiting for an earlier task to finish'
export type TurnStatus = { text: string }

export const ToolProgress = z.looseObject({ tool: z.optional(z.string()), name: z.optional(z.string()), label: z.optional(z.string()) })
export type ToolProgress = z.infer<typeof ToolProgress>

export const AGENT_HOME = '/opt/data/home'
export const UPLOADS = `${AGENT_HOME}/uploads`
export const MAX_FILE_BYTES = 25 << 20
export const MAX_FILES = 10
export const MAX_HOME_DEPTH = 32

export const UploadFile = z.object({
  name: z.string().check(z.minLength(1), z.maxLength(255)),
  type: z.optional(z.string().check(z.maxLength(100))),
})
export type UploadFile = z.infer<typeof UploadFile>

export const DeleteThread = z.nullish(z.object({ uploads: z.optional(z.array(z.string().check(z.maxLength(1024))).check(z.maxLength(MAX_FILES))) }))
export type DeleteThread = z.infer<typeof DeleteThread>

export const ReadFile = z.object({ path: z.string().check(z.minLength(1), z.maxLength(1024)) })
export type ReadFile = z.infer<typeof ReadFile>

export const ChatFile = z.object({
  object: z.literal('file'),
  name: z.string(),
  path: z.string(),
  size: z.number(),
  mediaType: z.string(),
})
export type ChatFile = z.infer<typeof ChatFile>

export const LookUpFiles = z.object({ paths: z.array(z.string().check(z.minLength(1), z.maxLength(1024))).check(z.maxLength(50)) })
export type LookUpFiles = z.infer<typeof LookUpFiles>

export const HomeFile = z.object({ object: z.literal('file'), name: z.string(), path: z.string(), size: z.number() })
export type HomeFile = z.infer<typeof HomeFile>

export function uploadName(path: string): string | undefined {
  const inside = path.startsWith(`${UPLOADS}/`) ? fileInHome(path)?.split('/') : undefined
  return inside?.length === 2 ? inside[1] : undefined
}

export function fileInHome(path: string): string | undefined {
  const full = path.startsWith('~/') ? `${AGENT_HOME}${path.slice(1)}` : path
  if (!full.startsWith(`${AGENT_HOME}/`) || full.length > 1024) return undefined
  const segments = full.slice(AGENT_HOME.length + 1).split('/')
  return segments.length <= MAX_HOME_DEPTH && segments.every((segment) => segment && segment !== '.' && segment !== '..' && !segment.includes('\0')) ? segments.join('/') : undefined
}

export const CreateThread = z.object({ agentId: z.string().check(z.maxLength(64)) })
export type CreateThread = z.infer<typeof CreateThread>

export const ListThreads = z.object({ archived: z.optional(z.enum(['true', 'false'])) })
export type ListThreads = z.infer<typeof ListThreads>


export const NOTIFY_RULES_MAX = 2000

export const AgentNotify = z.object({
  default: z.nullable(Place),
  rules: z.string().check(z.maxLength(NOTIFY_RULES_MAX)),
})
export type AgentNotify = z.infer<typeof AgentNotify>
