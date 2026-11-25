import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const Computer = z.object({
  id: z.string(),
  object: z.literal('computer'),
  name: z.string(),
  here: z.boolean(),
  joined: z.boolean(),
  online: z.boolean(),
  version: z.nullable(z.string()),
  gvisor: z.nullable(z.boolean()),
  features: z.object({ whatsapp: z.boolean(), browser: z.boolean() }),
  updateError: z.nullable(z.string()),
  agents: z.number(),
  seenAt: z.nullable(Timestamp),
})
export type Computer = z.infer<typeof Computer>

export const ComputerJoin = z.object({
  object: z.literal('computer_join'),
  computer: Computer,
  command: z.string(),
  expiresAt: Timestamp,
})
export type ComputerJoin = z.infer<typeof ComputerJoin>

export const RemovedComputer = z.object({ id: z.string(), object: z.literal('computer'), deleted: z.literal(true), uninstall: z.string() })
export type RemovedComputer = z.infer<typeof RemovedComputer>
