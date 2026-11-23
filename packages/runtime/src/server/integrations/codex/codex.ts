import * as z from 'zod/mini'
import { HttpError, messageOf } from '../../platform/http-error.ts'
import { config } from '../../platform/config.ts'
import { log } from '../../platform/events.ts'
import { settings } from '../../platform/settings.ts'
import { connectionRecords } from '../../connections/connection-records.ts'

const ISSUER = config.codexAuthApi
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const REFRESH_EARLY_MS = 5 * 60_000
const TIMEOUT_MS = 20_000
const UserCode = z.object({ device_auth_id: z.string(), user_code: z.string() })
const Authorized = z.object({ authorization_code: z.string(), code_verifier: z.string() })
const Tokens = z.object({ access_token: z.string(), refresh_token: z.optional(z.string()) })
const Claims = z.object({ exp: z.optional(z.number()), 'https://api.openai.com/auth': z.optional(z.object({ chatgpt_account_id: z.optional(z.string()) })) })
const Stored = z.object({ accessToken: z.string(), refreshToken: z.string() })
let refreshing: Promise<string> | undefined

export const codex = {
  signInUrl: `${ISSUER}/codex/device`,

  async requestCode(): Promise<{ deviceAuthId: string; userCode: string }> {
    const res = await call({ url: `${ISSUER}/api/accounts/deviceauth/usercode`, body: JSON.stringify({ client_id: CLIENT_ID }), type: 'application/json' })
    if (!res.ok) throw new HttpError(502, 'ChatGPT didn\'t start the sign-in. Try again in a minute.')
    const code = z.parse(UserCode, await res.json())
    return { deviceAuthId: code.device_auth_id, userCode: code.user_code }
  },

  async poll({ deviceAuthId, userCode }: { deviceAuthId: string; userCode: string }): Promise<CodexSecret | null> {
    const res = await call({ url: `${ISSUER}/api/accounts/deviceauth/token`, body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }), type: 'application/json' })
    if (res.status === 403 || res.status === 404) return null
    if (!res.ok) throw new HttpError(502, 'ChatGPT stopped the sign-in. Start again.')
    const { authorization_code: code, code_verifier: verifier } = z.parse(Authorized, await res.json())
    const tokens = await tokenRequest(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: `${ISSUER}/deviceauth/callback`, client_id: CLIENT_ID, code_verifier: verifier }))
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? '', at: new Date().toISOString() }
  },

  async accessToken(): Promise<string> {
    const stored = settings.codexTokens()
    if (!stored) throw new HttpError(409, 'ChatGPT isn\'t signed in on this computer. Sign in under Settings › Models.')
    if ((claimsOf(stored.accessToken).exp ?? 0) * 1000 - Date.now() > REFRESH_EARLY_MS) return stored.accessToken
    refreshing ??= refresh().finally(() => { refreshing = undefined })
    return refreshing
  },

  accountOf: (accessToken: string): string | undefined => claimsOf(accessToken)['https://api.openai.com/auth']?.chatgpt_account_id,
}

async function refresh(): Promise<string> {
  const secret = await connectionRecords.refresh({
    id: connectionRecords.providerId('codex'),
    renew: async (latest) => {
      const { refreshToken } = z.parse(Stored, latest)
      const tokens = await tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: CLIENT_ID }))
      return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? refreshToken, at: new Date().toISOString() }
    },
  })
  return z.parse(Stored, secret).accessToken
}

async function tokenRequest(form: URLSearchParams): Promise<z.infer<typeof Tokens>> {
  const res = await call({ url: `${ISSUER}/oauth/token`, body: form.toString(), type: 'application/x-www-form-urlencoded' })
  if (res.status === 400 || res.status === 401) throw new HttpError(409, 'ChatGPT signed you out. Sign in again under Settings › Models.')
  if (!res.ok) throw new HttpError(502, 'ChatGPT didn\'t finish the sign-in. Try again in a minute.')
  return z.parse(Tokens, await res.json())
}

function call({ url, body, type }: { url: string; body: string; type: string }): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'content-type': type, accept: 'application/json' }, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
    .catch((err: unknown) => {
      log.warn({ event: 'codex.unreachable', error: messageOf(err) })
      throw new HttpError(502, 'ChatGPT didn\'t answer. Check your connection and try again.')
    })
}

function claimsOf(token: string): z.infer<typeof Claims> {
  try {
    return z.parse(Claims, JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')))
  } catch {
    return {}
  }
}

export type CodexSecret = { accessToken: string; refreshToken: string; at: string }
