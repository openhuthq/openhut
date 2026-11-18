import * as z from 'zod/mini'

export const Invitation = z.object({
  object: z.literal('invitation'),
  id: z.string(),
  code: z.optional(z.string()),
  expiresAt: z.optional(z.string()),
  status: z.optional(z.enum(['waiting', 'joined', 'accepted', 'declined', 'expired'])),
  device: z.optional(z.object({ name: z.string(), kind: z.enum(['client', 'computer']), key: z.string() })),
  digits: z.optional(z.string()),
})
export type Invitation = z.infer<typeof Invitation>

export function spaced(digits: string) {
  return `${digits.slice(0, 3)} ${digits.slice(3)}`
}

export function joinCommand(code: string) {
  return `curl -fsSL openhut.dev | sh -s -- join '${code.replaceAll("'", '')}'`
}
