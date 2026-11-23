import * as z from 'zod/mini'
import { CloudSignIn, type MemberList } from '@openhut/common/cloud/cloud.ts'
import { OAuthAuthorization, OAuthToken, type CreateOAuthAuthorization, type CreateOAuthToken } from '@openhut/common/cloud/oauth.ts'
import { Session, SIGNATURE_HEADER, signRequest, type CreateSession } from '@openhut/common/cloud/v1/identity.ts'
import type { Identity, LetterPurpose } from '@openhut/common/vault/vault.ts'
import { config } from './config.ts'
import { HttpError } from './http-error.ts'

const CloudError = z.object({ error: z.object({ message: z.string() }) })
const AuthError = z.object({ message: z.string() })
const held = new Set<string>()

export type Letter = { to: string; purpose: LetterPurpose; body: string }
export type Box = { name: string; by: string; signature: string; body: string; savedAt: number }
export type Bundle = { list: MemberList; letters?: Letter[]; boxes?: Box[] }
export type Call = { method: 'GET' | 'PUT' | 'POST' | 'DELETE'; path: string; token: string; signer: Identity; body?: unknown }
export type Reply = { status: number; json: unknown }
export type CloudSession = { token: string; refresh: string; sub: string; email: string; expiresAt: string }

export const cloud = {
  authorization: (body: CreateOAuthAuthorization): Promise<OAuthAuthorization> => post({ base: config.cloudUrl, path: '/v1/oauth-authorizations', body, reply: OAuthAuthorization }),
  token: (body: CreateOAuthToken): Promise<OAuthToken> => post({ base: config.cloudUrl, path: '/v1/oauth-tokens', body, reply: OAuthToken }),
  signIn: (body: { provider: 'google'; device: string; redirectUrl: string; state: string }): Promise<CloudSignIn> => post({ path: '/v1/auth/sign-in/social', body, reply: CloudSignIn }),

  async session(body: CreateSession): Promise<CloudSession> {
    const made = await post({ path: '/v1/sessions', body, reply: Session })
    return { token: made.token, refresh: made.refreshToken, sub: made.sub, email: made.email, expiresAt: made.expiresAt }
  },

  eventsUrl: (): string => `${config.apiUrl.replace(/^http/, 'ws')}/v1/events`,

  async call({ method, path, token, signer, body }: Call): Promise<Reply> {
    const workspace = typeof body === 'object' && body && 'workspace' in body ? String(body.workspace) : ''
    if (held.has(workspace) && method === 'POST' && path === '/v1/letters') throw new HttpError(409, 'This team’s history doesn’t match another member’s, so no keys go out until it does. Check with your teammates.')
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, ...payload !== undefined && { 'content-type': 'application/json' } }
    if (method !== 'GET') headers[SIGNATURE_HEADER] = await signRequest({ signer, method, path, body: payload ?? '' })
    const response = await fetch(`${config.apiUrl}${path}`, { method, headers, body: payload, signal: AbortSignal.timeout(20_000) }).catch((error: unknown) => unreachable(error))
    return { status: response.status, json: await response.json().catch(() => undefined) }
  },

  hold({ workspace, on }: { workspace: string; on: boolean }): void {
    if (on) held.add(workspace)
    else held.delete(workspace)
  },
}

async function post<T>({ base = config.apiUrl, path, body, reply }: { base?: string; path: string; body: unknown; reply: z.ZodMiniType<T> }): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => unreachable(error))
  const json: unknown = await response.json().catch(() => undefined)
  const parsed = z.safeParse(reply, json)
  if (response.ok && parsed.success) return parsed.data
  throw new HttpError(502, z.safeParse(CloudError, json).data?.error.message ?? z.safeParse(AuthError, json).data?.message ?? `OpenHut Cloud answered HTTP ${response.status}.`)
}

function unreachable(error: unknown): never {
  throw new HttpError(502, `OpenHut Cloud didn’t answer (${error instanceof Error ? error.message : String(error)}). Check this computer’s internet connection.`)
}
