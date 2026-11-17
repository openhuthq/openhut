import * as z from 'zod/mini'
import { Timestamp, atLeastOneField } from '../api.ts'

export const Update = z.object({
  object: z.literal('update'),
  status: z.enum(['running', 'failed']),
  from: z.string(),
  to: z.string(),
  startedAt: Timestamp,
})
export type Update = z.infer<typeof Update>

export const Admin = z.object({
  object: z.literal('admin'),
  seat: z.object({ set: z.boolean(), mode: z.enum(['claude', 'test']), updatedAt: z.nullable(Timestamp) }),
  codex: z.object({ set: z.boolean(), updatedAt: z.nullable(Timestamp) }),
  server: z.object({
    version: z.string(),
    build: z.string(),
    latestBuild: z.nullable(z.string()),
    updateAvailable: z.boolean(),
    update: z.nullable(Update),
    healthy: z.boolean(),
    agentd: z.boolean(),
    firewall: z.boolean(),
    running: z.number(),
    total: z.number(),
  }),
  tailnetUrl: z.nullable(z.string()),
  google: z.object({ clientId: z.nullable(z.string()), redirectUri: z.string() }),
  usageData: z.boolean(),
  publicKey: z.string(),
})
export type Admin = z.infer<typeof Admin>

export const Health = z.object({
  ok: z.boolean(),
  version: z.string(),
  build: z.string(),
  agentd: z.boolean(),
  firewall: z.boolean(),
  started: z.number(),
})
export type Health = z.infer<typeof Health>

export const UpdateAdminFields = {
  seatToken: z.optional(z.string().check(z.regex(/^\S{20,}$/, 'Paste the token that `claude setup-token` printed.'), z.maxLength(2000))),
  tailnetUrl: z.optional(z.nullable(z.url({ protocol: /^https$/ }).check(z.maxLength(200)))),
  googleClientId: z.optional(z.string().check(z.regex(/^[\w.-]+\.apps\.googleusercontent\.com$/, 'Paste the client ID. It ends in .apps.googleusercontent.com.'))),
  usageData: z.optional(z.boolean()),
  googleClientSecret: z.optional(z.string().check(z.regex(/^\S{10,200}$/, 'Paste the client secret from the same OAuth client.'))),
}
export const UpdateAdmin = z.object(UpdateAdminFields).check(atLeastOneField)
export type UpdateAdmin = z.infer<typeof UpdateAdmin>

export const SeatSignIn = z.object({
  id: z.string(),
  object: z.literal('seat_sign_in'),
  status: z.enum(['open', 'complete']),
  url: z.nullable(z.string()),
})
export type SeatSignIn = z.infer<typeof SeatSignIn>

export const CodexSignIn = z.object({
  id: z.string(),
  object: z.literal('codex_sign_in'),
  status: z.enum(['open', 'complete']),
  url: z.string(),
  userCode: z.string(),
})
export type CodexSignIn = z.infer<typeof CodexSignIn>

export const CompleteSeatSignIn = z.object({ code: z.string().check(z.minLength(10), z.maxLength(2000)) })
export type CompleteSeatSignIn = z.infer<typeof CompleteSeatSignIn>

export const SeatWindow = z.object({
  kind: z.enum(['five_hour', 'seven_day']),
  percent: z.number(),
  resetsAt: z.nullable(Timestamp),
})
export type SeatWindow = z.infer<typeof SeatWindow>

export const SeatUsage = z.object({
  object: z.literal('seat_usage'),
  windows: z.array(SeatWindow),
  since: Timestamp,
  agents: z.array(z.object({ agentId: z.string(), agentName: z.string(), costUsd: z.number() })),
})
export type SeatUsage = z.infer<typeof SeatUsage>

export const Subscription = z.enum(['claude', 'codex'])
export type Subscription = z.infer<typeof Subscription>

export const CreateExport = z.object({
  publicKey: z.string().check(z.regex(/^[\w+/=-]{40,100}$/, 'Send the publicKey from the other computer\'s GET /api/admin.')),
  connectionId: z.optional(z.string().check(z.maxLength(40))),
  subscription: z.optional(Subscription),
})
export type CreateExport = z.infer<typeof CreateExport>

export const Export = z.object({ object: z.literal('export'), sealed: z.string() })
export type Export = z.infer<typeof Export>

export const CreateImport = z.object({ sealed: z.string().check(z.maxLength(64_000)) })
export type CreateImport = z.infer<typeof CreateImport>
