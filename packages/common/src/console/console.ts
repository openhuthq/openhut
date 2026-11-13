import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const Release = z.object({
  id: z.string(),
  object: z.literal('release'),
  build: z.string(),
  version: z.string(),
  sha256: z.string(),
  url: z.string(),
  notes: z.string(),
  createdAt: Timestamp,
})
export type Release = z.infer<typeof Release>

export const CreateRelease = z.object({
  build: z.string().check(z.regex(/^\d{14}$/, 'Give the build as the release timestamp YYYYMMDDHHMMSS, like 20261113120000.')),
  version: z.string().check(z.regex(/^\d+\.\d+\.\d+$/, 'Give the version as major.minor.patch, like 0.1.0.')),
  sha256: z.string().check(z.regex(/^[a-f0-9]{64}$/, 'Give the sha256 as the 64 hex characters that `shasum -a 256` prints.')),
  url: z.url({ protocol: /^https?$/ }).check(z.maxLength(500)),
  notes: z.optional(z.string().check(z.maxLength(4000))),
})
export type CreateRelease = z.infer<typeof CreateRelease>

export const Install = z.object({
  id: z.string(),
  object: z.literal('install'),
  build: z.string(),
  version: z.string(),
  lastCheckInAt: Timestamp,
  createdAt: Timestamp,
})
export type Install = z.infer<typeof Install>

export const CheckIn = z.object({
  object: z.literal('check_in'),
  installId: z.string(),
  build: z.string(),
  version: z.string(),
  createdAt: Timestamp,
})
export type CheckIn = z.infer<typeof CheckIn>

export const CreateCheckIn = z.object({
  installId: z.string().check(z.regex(/^[\w-]{32,128}$/, 'Send a random installId of 32 to 128 letters, digits, dashes or underscores.')),
  build: z.string().check(z.minLength(1), z.maxLength(40)),
  version: z.string().check(z.minLength(1), z.maxLength(40)),
})
export type CreateCheckIn = z.infer<typeof CreateCheckIn>
