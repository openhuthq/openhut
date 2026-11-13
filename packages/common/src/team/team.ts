import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const TeamRole = z.enum(['owner', 'admin', 'member'])
export type TeamRole = z.infer<typeof TeamRole>

export const MemberRole = z.enum(['admin', 'member'])
export type MemberRole = z.infer<typeof MemberRole>

const Username = z.string().check(z.regex(/^[a-z0-9._-]{2,32}$/, 'Pick a username of 2 to 32 lowercase letters, digits, dots, dashes or underscores.'))
const Password = z.string().check(z.minLength(12, 'Pick a password of at least 12 characters.'), z.maxLength(200))

export const Person = z.object({
  id: z.string(),
  object: z.literal('person'),
  username: z.string(),
  role: TeamRole,
  joinedAt: Timestamp,
})
export type Person = z.infer<typeof Person>

export const Session = z.object({
  id: z.string(),
  object: z.literal('session'),
  person: Person,
  expiresAt: Timestamp,
})
export type Session = z.infer<typeof Session>

export const Me = z.object({
  object: z.literal('me'),
  user: Person,
  publicUrl: z.string(),
})
export type Me = z.infer<typeof Me>

export const Setup = z.object({
  object: z.literal('setup'),
  open: z.boolean(),
})
export type Setup = z.infer<typeof Setup>

export const Invite = z.object({
  id: z.string(),
  object: z.literal('invite'),
  role: MemberRole,
  createdBy: z.string(),
  expiresAt: Timestamp,
  link: z.optional(z.string()),
})
export type Invite = z.infer<typeof Invite>

export const InviteLink = z.object({
  id: z.string(),
  object: z.literal('invite_link'),
  role: MemberRole,
  expiresAt: Timestamp,
})
export type InviteLink = z.infer<typeof InviteLink>

export const CreatePerson = z.union([
  z.object({ setupCode: z.string().check(z.maxLength(200)), username: Username, password: Password }),
  z.object({ inviteToken: z.string().check(z.maxLength(200)), username: Username, password: Password }),
])
export type CreatePerson = z.infer<typeof CreatePerson>

export const CreateSession = z.object({ username: z.string().check(z.maxLength(64)), password: z.string().check(z.maxLength(200)) })
export type CreateSession = z.infer<typeof CreateSession>

export const CreateInvite = z.object({ role: MemberRole })
export type CreateInvite = z.infer<typeof CreateInvite>
