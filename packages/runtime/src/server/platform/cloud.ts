import * as z from 'zod/mini'
import { CloudSession, CloudSignIn, type MemberList } from '@openhut/common/cloud/cloud.ts'
import { OAuthAuthorization, OAuthToken, type CreateOAuthAuthorization, type CreateOAuthToken } from '@openhut/common/cloud/oauth.ts'
import type { LetterPurpose } from '@openhut/common/vault/vault.ts'
import { config } from './config.ts'
import { HttpError } from './http-error.ts'

const CloudError = z.object({ error: z.object({ message: z.string() }) })
const AuthError = z.object({ message: z.string() })
const RENAMED: Record<string, string> = { requests: 'join-requests' }
const held = new Set<string>()

export type Letter = { to: string; purpose: LetterPurpose; body: string }
export type Box = { name: string; by: string; signature: string; body?: string; savedAt?: number; deleted?: boolean }
export type Bundle = { list: MemberList; letters?: Letter[]; boxes?: Box[] }

export const cloud = {
  authorization: (body: CreateOAuthAuthorization): Promise<OAuthAuthorization> => post({ path: '/v1/oauth-authorizations', body, reply: OAuthAuthorization }),
  token: (body: CreateOAuthToken): Promise<OAuthToken> => post({ path: '/v1/oauth-tokens', body, reply: OAuthToken }),
  signIn: (body: { provider: 'google'; device: string; redirectUrl: string; state: string }): Promise<CloudSignIn> => post({ path: '/v1/auth/sign-in/social', body, reply: CloudSignIn }),
  claim: (body: { code: string; signature: string }): Promise<CloudSession> => post({ path: '/v1/sessions', body, reply: CloudSession }),
  join: (body: { join: string; device: string; signature: string }): Promise<CloudSession> => post({ path: '/v1/sessions', body, reply: CloudSession }),
  refresh: (body: { session: string; signedAt: number; signature: string }): Promise<CloudSession> => post({ path: '/v1/sessions', body, reply: CloudSession }),
  eventsUrl: (): string => `${config.apiUrl.replace(/^http/, 'ws')}/v1/events`,

  room: async ({ workspace, path, ...rest }: Call & { workspace: string }): Promise<Reply> => {
    if (held.has(workspace) && rest.method === 'POST' && path === '/letters') throw new HttpError(409, 'This team’s history doesn’t match another member’s, so no keys go out until it does. Check with your teammates.')
    return call({ ...rest, path: flat({ workspace, path }) })
  },

  async memberLists({ token, list, letters = [], boxes = [] }: Bundle & { token: string }): Promise<Reply> {
    return call({ method: 'POST', path: '/v1/member-lists', token, body: { list, letters, boxes } })
  },

  hold({ workspace, on }: { workspace: string; on: boolean }): void {
    if (on) held.add(workspace)
    else held.delete(workspace)
  },
  account: call,
}

type Call = { method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE'; path: string; token: string; body?: unknown }
type Reply = { status: number; json: unknown }

function flat({ workspace, path }: { workspace: string; path: string }): string {
  const url = new URL(path, 'http://cloud/')
  const [name, ...rest] = url.pathname.split('/').filter(Boolean)
  if (!name) return `/v1/workspaces/${workspace}`
  url.searchParams.set('workspace', workspace)
  return `/v1/${[RENAMED[name] ?? name, ...rest].join('/')}?${url.searchParams}`
}

async function call({ method, path, token, body }: Call): Promise<Reply> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => unreachable(error))
  return { status: response.status, json: await response.json().catch(() => undefined) }
}

async function post<T>({ path, body, reply }: { path: string; body: unknown; reply: z.ZodMiniType<T> }): Promise<T> {
  const response = await fetch(`${config.apiUrl}${path}`, {
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
