import * as z from 'zod/mini'
import { OAuthAuthorization, OAuthToken, type CreateOAuthAuthorization, type CreateOAuthToken } from '@openhut/common/cloud/oauth.ts'
import { config } from './config.ts'

const CloudError = z.object({ error: z.object({ message: z.string() }) })

export const cloud = {
  authorization: (body: CreateOAuthAuthorization): Promise<OAuthAuthorization> => post({ path: '/v1/oauth-authorizations', body, reply: OAuthAuthorization }),
  token: (body: CreateOAuthToken): Promise<OAuthToken> => post({ path: '/v1/oauth-tokens', body, reply: OAuthToken }),
}

async function post<T>({ path, body, reply }: { path: string; body: unknown; reply: z.ZodMiniType<T> }): Promise<T> {
  const response = await fetch(`${config.cloudUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => {
    throw new Error(`OpenHut Cloud didn’t answer (${error instanceof Error ? error.message : String(error)}). Check this computer’s internet connection.`)
  })
  const json: unknown = await response.json().catch(() => undefined)
  const parsed = z.safeParse(reply, json)
  if (response.ok && parsed.success) return parsed.data
  throw new Error(z.safeParse(CloudError, json).data?.error.message ?? `OpenHut Cloud answered HTTP ${response.status}.`)
}
