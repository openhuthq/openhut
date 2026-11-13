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
  seat: z.object({ set: z.boolean(), mode: z.enum(['claude', 'test']) }),
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
  publicUrl: z.string(),
  google: z.object({ clientId: z.nullable(z.string()), redirectUri: z.string() }),
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
  publicUrl: z.optional(z.url({ protocol: /^https?$/ }).check(z.maxLength(200))),
  googleClientId: z.optional(z.string().check(z.regex(/^[\w.-]+\.apps\.googleusercontent\.com$/, 'Paste the client ID. It ends in .apps.googleusercontent.com.'))),
  googleClientSecret: z.optional(z.string().check(z.regex(/^\S{10,200}$/, 'Paste the client secret from the same OAuth client.'))),
}
export const UpdateAdmin = z.object(UpdateAdminFields).check(atLeastOneField)
export type UpdateAdmin = z.infer<typeof UpdateAdmin>

export const AgentContainer = z.object({
  object: z.literal('container'),
  agentId: z.string(),
  agentName: z.nullable(z.string()),
  wanted: z.nullable(z.enum(['running', 'stopped'])),
  name: z.nullable(z.string()),
  state: z.string(),
  status: z.string(),
  image: z.string(),
  createdAt: z.string(),
  network: z.string(),
})
export type AgentContainer = z.infer<typeof AgentContainer>

export const SeatSignIn = z.object({
  id: z.string(),
  object: z.literal('seat_sign_in'),
  status: z.enum(['open', 'complete']),
  url: z.nullable(z.string()),
})
export type SeatSignIn = z.infer<typeof SeatSignIn>

export const CompleteSeatSignIn = z.object({ code: z.string().check(z.minLength(10), z.maxLength(2000)) })
export type CompleteSeatSignIn = z.infer<typeof CompleteSeatSignIn>
