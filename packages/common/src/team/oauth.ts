import * as z from 'zod/mini'
import { Timestamp } from '../api.ts'

export const OAuthClient = z.object({
  id: z.string(),
  object: z.literal('oauth_client'),
  name: z.string(),
  redirectUris: z.array(z.string()),
})
export type OAuthClient = z.infer<typeof OAuthClient>

export const OAuthCode = z.object({
  object: z.literal('oauth_code'),
  redirect: z.string(),
})
export type OAuthCode = z.infer<typeof OAuthCode>

export const OAuthGrant = z.object({
  id: z.string(),
  object: z.literal('oauth_grant'),
  client: z.string(),
  createdAt: Timestamp,
  usedAt: z.nullable(Timestamp),
})
export type OAuthGrant = z.infer<typeof OAuthGrant>

export const CreateOAuthCode = z.object({
  clientId: z.string(),
  redirectUri: z.string(),
  codeChallenge: z.string(),
  codeChallengeMethod: z.string(),
  state: z.optional(z.string()),
  allow: z.boolean(),
})
export type CreateOAuthCode = z.infer<typeof CreateOAuthCode>
