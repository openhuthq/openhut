import * as z from 'zod/mini'

export const LIVE_BEAT_MS = 60_000
export const LiveEvent = z.object({ object: z.literal('event'), type: z.string(), data: z.object({ object: z.string(), id: z.string() }) })
export type LiveEvent = z.infer<typeof LiveEvent>
