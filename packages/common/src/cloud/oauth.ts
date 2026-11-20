import * as z from 'zod/mini'

export const OAUTH_PROVIDERS = ['google'] as const
export const OAuthProvider = z.enum(OAUTH_PROVIDERS)
export type OAuthProvider = z.infer<typeof OAuthProvider>

export const CreateOAuthAuthorization = z.object({
  provider: OAuthProvider,
  scopes: z.array(z.string().check(z.maxLength(200))).check(z.minLength(1), z.maxLength(40)),
  codeChallenge: z.string().check(z.regex(/^[A-Za-z0-9_-]{43,128}$/, 'Send the S256 PKCE challenge, base64url.')),
  redirectUrl: z.string().check(z.maxLength(500)),
  state: z.string().check(z.minLength(8), z.maxLength(200)),
  deviceKey: z.optional(z.string().check(z.regex(/^[A-Za-z0-9_-]{86}$/, 'Send a device key as 64 bytes of base64url.'))),
})
export type CreateOAuthAuthorization = z.infer<typeof CreateOAuthAuthorization>

export const OAuthAuthorization = z.object({
  id: z.string(),
  object: z.literal('oauth_authorization'),
  provider: OAuthProvider,
  authorizationUrl: z.string(),
  expiresAt: z.string(),
})
export type OAuthAuthorization = z.infer<typeof OAuthAuthorization>

export const CreateOAuthToken = z.discriminatedUnion('grantType', [
  z.object({ provider: OAuthProvider, grantType: z.literal('authorization_code'), code: z.string().check(z.maxLength(2000)), codeVerifier: z.string().check(z.maxLength(200)) }),
  z.object({ provider: OAuthProvider, grantType: z.literal('refresh_token'), refreshToken: z.string().check(z.maxLength(2000)) }),
])
export type CreateOAuthToken = z.infer<typeof CreateOAuthToken>

export const OAuthToken = z.object({
  object: z.literal('oauth_token'),
  provider: OAuthProvider,
  accessToken: z.string(),
  refreshToken: z.optional(z.string()),
  expiresAt: z.string(),
  scopes: z.array(z.string()),
  email: z.optional(z.string()),
})
export type OAuthToken = z.infer<typeof OAuthToken>

export const OAUTH_ERROR_TYPES = ['invalid_request_error', 'invalid_grant', 'provider_error', 'rate_limit_error', 'api_error'] as const
