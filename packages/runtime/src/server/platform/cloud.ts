import * as z from 'zod/mini'
import { CloudSession, type CreateCloudSession, type DeviceSession } from '@openhut/common/cloud/cloud.ts'
import { OAuthAuthorization, OAuthToken, type CreateOAuthAuthorization, type CreateOAuthToken } from '@openhut/common/cloud/oauth.ts'
import { config } from './config.ts'
import { HttpError } from './http-error.ts'

const CloudError = z.object({ error: z.object({ message: z.string() }) })

export const cloud = {
  authorization: (body: CreateOAuthAuthorization): Promise<OAuthAuthorization> => post({ path: '/v1/oauth-authorizations', body, reply: OAuthAuthorization }),
  token: (body: CreateOAuthToken): Promise<OAuthToken> => post({ path: '/v1/oauth-tokens', body, reply: OAuthToken }),
  session: (body: CreateCloudSession): Promise<CloudSession> => post({ path: '/v1/sessions', body, reply: CloudSession }),
  deviceSession: ({ workspace, ...body }: DeviceSession & { workspace: string }): Promise<CloudSession> => post({ path: `/v1/workspaces/${workspace}/sessions`, body, reply: CloudSession }),
  roomUrl: (workspace: string): string => `${config.cloudUrl.replace(/^http/, 'ws')}/v1/workspaces/${workspace}`,

  room: ({ workspace, path, ...rest }: Call & { workspace: string }): Promise<Reply> => call({ ...rest, path: `/v1/workspaces/${workspace}${path}` }),
  account: call,

  async putFile({ workspace, hash, token, body }: { workspace: string; hash: string; token: string; body: Uint8Array }): Promise<number> {
    const response = await fetch(`${config.cloudUrl}/v1/workspaces/${workspace}/files/${hash}`, {
      method: 'PUT', headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(120_000),
    }).catch((error: unknown) => unreachable(error))
    return response.status
  },

  async getFile({ workspace, hash, token }: { workspace: string; hash: string; token: string }): Promise<Uint8Array<ArrayBuffer> | null> {
    const response = await fetch(`${config.cloudUrl}/v1/workspaces/${workspace}/files/${hash}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) }).catch((error: unknown) => unreachable(error))
    return response.ok ? new Uint8Array(await response.arrayBuffer()) : null
  },
}

type Call = { method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE'; path: string; token: string; body?: unknown }
type Reply = { status: number; json: unknown }

async function call({ method, path, token, body }: Call): Promise<Reply> {
  const response = await fetch(`${config.cloudUrl}${path}`, {
    method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => unreachable(error))
  return { status: response.status, json: await response.json().catch(() => undefined) }
}

async function post<T>({ path, body, reply }: { path: string; body: unknown; reply: z.ZodMiniType<T> }): Promise<T> {
  const response = await fetch(`${config.cloudUrl}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000),
  }).catch((error: unknown) => unreachable(error))
  const json: unknown = await response.json().catch(() => undefined)
  const parsed = z.safeParse(reply, json)
  if (response.ok && parsed.success) return parsed.data
  throw new HttpError(502, z.safeParse(CloudError, json).data?.error.message ?? `OpenHut Cloud answered HTTP ${response.status}.`)
}

function unreachable(error: unknown): never {
  throw new HttpError(502, `OpenHut Cloud didn’t answer (${error instanceof Error ? error.message : String(error)}). Check this computer’s internet connection.`)
}
