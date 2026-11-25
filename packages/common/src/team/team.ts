import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const TeamRole = z.enum(['owner', 'admin', 'member'])
export type TeamRole = z.infer<typeof TeamRole>

export const MemberRole = z.enum(['admin', 'member'])
export type MemberRole = z.infer<typeof MemberRole>

export const PASSWORD_MIN = 12
const Email = z.email('Enter an email address, like you@company.com.').check(z.maxLength(254), z.toLowerCase())
const Password = z.string().check(z.minLength(PASSWORD_MIN, `Pick a password of at least ${PASSWORD_MIN} characters.`), z.maxLength(200))
const Name = z.string().check(z.trim(), z.minLength(1, 'Enter your name.'), z.maxLength(80))

export const Person = z.object({
  id: z.string(),
  object: z.literal('person'),
  email: z.string(),
  name: z.string(),
  role: TeamRole,
  joinedAt: Timestamp,
})
export type Person = z.infer<typeof Person>

export const Me = z.object({
  object: z.literal('me'),
  user: Person,
  timeZone: z.string(),
})
export type Me = z.infer<typeof Me>

export const Setup = z.object({
  object: z.literal('setup'),
  open: z.boolean(),
  googleSignIn: z.boolean(),
  passwordReset: z.boolean(),
})
export type Setup = z.infer<typeof Setup>

export const Session = z.object({ id: z.string(), object: z.literal('session'), person: Person, expiresAt: Timestamp })
export type Session = z.infer<typeof Session>

export const Invite = z.object({ id: z.string(), object: z.literal('invite'), role: MemberRole, createdAt: Timestamp, expiresAt: Timestamp, link: z.optional(z.string()) })
export type Invite = z.infer<typeof Invite>

export const CreatePerson = z.union([
  z.object({ address: z.string().check(z.maxLength(300)), email: Email, password: Password }),
  z.object({ inviteToken: z.string().check(z.maxLength(200)), name: Name, email: Email, password: Password }),
])
export type CreatePerson = z.infer<typeof CreatePerson>

export const UpdatePerson = z.object({ role: MemberRole })
export type UpdatePerson = z.infer<typeof UpdatePerson>

export const CreateSession = z.object({ email: z.string().check(z.maxLength(254), z.toLowerCase()), password: z.string().check(z.maxLength(200)) })
export type CreateSession = z.infer<typeof CreateSession>

export const CreateInvite = z.object({ role: MemberRole })
export type CreateInvite = z.infer<typeof CreateInvite>

export const CreatePasswordReset = z.object({ email: z.string().check(z.maxLength(254), z.toLowerCase()) })
export type CreatePasswordReset = z.infer<typeof CreatePasswordReset>

export const FinishPasswordReset = z.object({ token: z.string().check(z.maxLength(200)), password: Password })
export type FinishPasswordReset = z.infer<typeof FinishPasswordReset>

export const InstallSettings = z.object({
  object: z.literal('install_settings'),
  address: z.object({ url: z.nullable(z.string()), certificateUntil: z.nullable(Timestamp) }),
  google: z.object({ set: z.boolean(), signIn: z.boolean(), clientId: z.nullable(z.string()), signInRedirectUri: z.string(), connectionsRedirectUri: z.string() }),
  smtp: z.object({ set: z.boolean(), host: z.nullable(z.string()), port: z.nullable(z.number()), user: z.nullable(z.string()), from: z.nullable(z.string()) }),
  usageData: z.boolean(),
})
export type InstallSettings = z.infer<typeof InstallSettings>

export const UpdateInstallSettings = z.object({
  address: z.optional(z.string().check(z.maxLength(300))),
  googleClientId: z.optional(z.string().check(z.trim(), z.regex(/^\S{10,200}\.apps\.googleusercontent\.com$/, 'Paste the client ID Google shows, ending in .apps.googleusercontent.com.'))),
  googleClientSecret: z.optional(z.string().check(z.trim(), z.regex(/^\S{10,200}$/, 'Paste the client secret Google shows.'))),
  googleSignIn: z.optional(z.boolean()),
  smtpHost: z.optional(z.string().check(z.trim(), z.regex(/^[a-zA-Z0-9.-]{1,253}$/, 'Enter the SMTP host, like smtp.example.com.'))),
  smtpPort: z.optional(z.number().check(z.int(), z.gte(1), z.lte(65535))),
  smtpUser: z.optional(z.string().check(z.maxLength(254))),
  smtpPassword: z.optional(z.string().check(z.maxLength(500))),
  smtpFrom: z.optional(Email),
  usageData: z.optional(z.boolean()),
})
export type UpdateInstallSettings = z.infer<typeof UpdateInstallSettings>
