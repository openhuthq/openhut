import * as z from 'zod/mini'

export const Browser = z.object({
  id: z.string(),
  object: z.literal('browser'),
  agentId: z.string(),
  open: z.boolean(),
  url: z.string(),
  title: z.string(),
  still: z.nullable(z.string()),
  heldBy: z.nullable(z.string()),
})
export type Browser = z.infer<typeof Browser>

const Coordinate = z.number().check(z.minimum(0), z.maximum(20_000))
const Modifiers = z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(15)))

const MouseInput = z.object({
  type: z.literal('mouse'),
  action: z.enum(['down', 'up', 'move', 'wheel']),
  x: Coordinate,
  y: Coordinate,
  button: z.optional(z.enum(['left', 'middle', 'right'])),
  clickCount: z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(3))),
  deltaX: z.optional(z.number().check(z.minimum(-10_000), z.maximum(10_000))),
  deltaY: z.optional(z.number().check(z.minimum(-10_000), z.maximum(10_000))),
  modifiers: Modifiers,
})

const KeyInput = z.object({
  type: z.literal('key'),
  action: z.enum(['down', 'up']),
  key: z.string().check(z.minLength(1), z.maxLength(32)),
  code: z.optional(z.string().check(z.maxLength(32))),
  modifiers: Modifiers,
})

export const BrowserInput = z.object({ events: z.array(z.union([MouseInput, KeyInput])).check(z.minLength(1), z.maxLength(64)) })
export type BrowserInput = z.infer<typeof BrowserInput>
export type BrowserInputEvent = BrowserInput['events'][number]

export const BrowserInputAccepted = z.object({ object: z.literal('browser_input'), agentId: z.string(), accepted: z.number() })
export type BrowserInputAccepted = z.infer<typeof BrowserInputAccepted>
