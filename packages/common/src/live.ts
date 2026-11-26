import * as z from 'zod/mini'

export const LIVE_BEAT_MS = 60_000
export const LiveEvent = z.object({ object: z.literal('event'), type: z.string(), data: z.object({ object: z.string(), id: z.string() }) })
export type LiveEvent = z.infer<typeof LiveEvent>

export const LIVE_TYPING_MS = 5_000
export const LIVE_DELTA_MS = 40

const ThreadId = z.string().check(z.minLength(1), z.maxLength(100))
export const LiveUp = z.union([
  z.object({ type: z.enum(['join', 'leave']), thread: ThreadId }),
  z.object({ type: z.literal('typing'), thread: ThreadId, on: z.boolean() }),
])
export type LiveUp = z.infer<typeof LiveUp>

export type LivePerson = { id: string; name: string; email: string; state: 'viewing' | 'typing' }
export type AgentLive = { state: 'idle' | 'thinking' | 'working' | 'replying'; step?: string; turnId?: string; answering?: string[] }
export type LivePresence = { type: 'presence'; thread: string; people: LivePerson[]; agent: AgentLive }
export type LiveDelta = { type: 'delta'; thread: string; turnId: string; seq: number; text: string }
export type LiveTurn = { type: 'turn'; thread: string; turnId: string; state: 'started' | 'done' }
export type LiveError = { type: 'error'; thread?: string; message: string }
export type LiveDown = LivePresence | LiveDelta | LiveTurn | LiveError
export type ThreadLive = { object: 'thread_live'; thread: string; turnId: string | null; seq: number; text: string; agent: AgentLive }
