import { ApiError, List } from '@openhut/common/api.ts'
import { Admin } from '@openhut/common/admin/admin.ts'
import { Agent, Grant } from '@openhut/common/agents/agent.ts'
import { Me } from '@openhut/common/team/team.ts'
import type { Computer, Features } from '@/lib/computers'

export type { Computer, Features }
export type Where = { computer?: string; of?: string }
export type OpenHutAgent = Agent & { computer: string; online: boolean }

type Schema<T> = { safeParse: (data: unknown) => { success: true; data: T } | { success: false } }
const LOCAL = 'local'
const AGENT_LIST = List(Agent)

export class RequestError extends Error {
  readonly status: number
  readonly param: string | undefined

  constructor({ message, status, param }: { message: string; status: number; param?: string }) {
    super(message)
    this.status = status
    this.param = param
  }
}

export async function request<T>({ schema, path, method = 'GET', body }: Where & { schema: Schema<T>; path: string; method?: string; body?: unknown }): Promise<T> {
  const response = await openhut.fetch({ path, init: { method, ...payloadOf(body) } })
  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw failure({ status: response.status, payload })
  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw new RequestError({ message: 'OpenHut got an answer it doesn\'t understand. Update OpenHut and try again.', status: response.status })
  return parsed.data
}

export async function requestBlob({ path }: Where & { path: string }): Promise<Blob> {
  const response = await openhut.fetch({ path })
  if (!response.ok) throw failure({ status: response.status, payload: await response.json().catch(() => null) })
  return response.blob()
}

export const openhut = {
  fetch: ({ path, init }: { path: string; init?: RequestInit }): Promise<Response> => fetch(path, init),
  agents: {
    list: async (): Promise<OpenHutAgent[]> => (await request({ schema: AGENT_LIST, path: '/api/agents' })).data.map(here),
  },
  connections: {
    grant: ({ connection, agent }: { connection: string; agent: string }): Promise<Grant> => request({ schema: Grant, path: '/api/grants', method: 'POST', body: { agentId: agent, connectionId: connection } }),
  },
  computers: {
    async list(): Promise<Computer[]> {
      const admin = await request({ schema: Admin, path: '/api/admin' }).catch(() => undefined)
      return [{ id: LOCAL, name: 'This computer', version: admin?.server.version ?? null, online: !!admin, features: admin?.features ?? { whatsapp: false, browser: false } }]
    },
  },
  account: {
    me: (): Promise<Me> => request({ schema: Me, path: '/api/me' }),
  },
}

function here(agent: Agent): OpenHutAgent {
  return { ...agent, computer: agent.runsHere || !agent.runsOn ? LOCAL : agent.runsOn, online: true }
}

function payloadOf(body: unknown): RequestInit {
  if (body instanceof Blob) return { body, headers: { 'content-type': 'application/octet-stream' } }
  if (body === undefined) return {}
  return { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
}

function failure({ status, payload }: { status: number; payload: unknown }): RequestError {
  const parsed = ApiError.safeParse(payload)
  if (!parsed.success) return new RequestError({ message: 'Something went wrong. Try again in a moment.', status })
  return new RequestError({ message: parsed.data.error.message, status, param: parsed.data.error.param })
}
