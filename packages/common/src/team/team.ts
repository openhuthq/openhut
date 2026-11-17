import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const Person = z.object({
  id: z.string(),
  object: z.literal('person'),
  email: z.string(),
  joinedAt: Timestamp,
})
export type Person = z.infer<typeof Person>

export const Me = z.object({
  object: z.literal('me'),
  user: Person,
  timeZone: z.string(),
})
export type Me = z.infer<typeof Me>
