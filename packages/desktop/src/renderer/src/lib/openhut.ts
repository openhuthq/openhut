import * as z from 'zod/mini'
import { ApiError, List } from '@openhut/common/api.ts'
import { Admin } from '@openhut/common/admin/admin.ts'
import { Agent, Grant } from '@openhut/common/agents/agent.ts'
import { Connection, type CreateConnection } from '@openhut/common/connections/connection.ts'
import { PROVIDERS, Provider, type ProviderId } from '@openhut/common/models/provider.ts'
import { Me } from '@openhut/common/team/team.ts'
import { WORDS } from '@/lib/platform'

export type Features = { whatsapp: boolean; browser: boolean }
export type Computer = { id: string; name: string; url: string; route?: 'relay' | 'tailnet'; online: boolean; features: Features; appTooOld: boolean; runtimeTooOld: boolean }
export type TailnetPeer = { name: string; dns: string }
export type Where = { computer?: string; of?: string }
export type OpenHutAgent = Agent & { computer: string; online: boolean }
export type Copy = { computer: string; id: string; online: boolean }
export type OpenHutConnection = Connection & { computers: Copy[] }
export type ProviderRow = { computer: string; online: boolean; providers: Provider[] }
export type Enrollment = { peer: TailnetPeer; lines: string[]; url: string | null; startedAt: number; status: 'running' | 'failed'; error: string; retryAt: number | null; retried: boolean; waitingAt?: number | null; log?: string }

type Schema<T> = { safeParse: (data: unknown) => { success: true; data: T } | { success: false } }
type Bridge = {
  version?: string
  computers?: {
    add: (input: { peer: TailnetPeer; join: string }) => Promise<unknown>
    enrollments: () => Promise<Enrollment[]>
    dismiss: (input: { dns: string }) => Promise<unknown>
    onEnrollments: (listener: (list: Enrollment[]) => void) => void
  }
}

const bridge: Bridge | undefined = Reflect.get(window, 'openhut')
const LOCAL = 'local'
const AGENT_LIST = List(Agent)
const CONNECTION_LIST = List(Connection)
const PROVIDER_LIST = List(Provider)
const JoinCode = z.object({ code: z.string() })

export const APP_VERSION = bridge?.version ?? ''

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
  fetch: ({ path, init }: Where & { path: string; init?: RequestInit }): Promise<Response> => fetch(path, init),
  agents: {
    list: async (): Promise<OpenHutAgent[]> => (await request({ schema: AGENT_LIST, path: '/api/agents' })).data.map(here),
    move: async ({ id, to }: { id: string; to: string }): Promise<OpenHutAgent> =>
      here(await request({ schema: Agent, path: `/api/agents/${encodeURIComponent(id)}`, method: 'PATCH', body: to === LOCAL ? { runsHere: true } : { runsOn: to } })),
  },
  connections: {
    list: async (): Promise<OpenHutConnection[]> => (await request({ schema: CONNECTION_LIST, path: '/api/connections' })).data.map((connection) => ({ ...connection, computers: [{ computer: LOCAL, id: connection.id, online: true }] })),
    connect: ({ computer: _computer, ...body }: CreateConnection & { computer?: string }): Promise<Connection> => request({ schema: Connection, path: '/api/connections', method: 'POST', body }),
    async addTo({ id }: { id: string; computer: string }): Promise<Connection> {
      const found = (await openhut.connections.list()).find((each) => each.id === id)
      if (!found) throw new RequestError({ message: 'That connection isn\'t here anymore. Refresh and try again.', status: 404 })
      return found
    },
    grant: ({ connection, agent }: { connection: string; agent: string }): Promise<Grant> => request({ schema: Grant, path: '/api/grants', method: 'POST', body: { agentId: agent, connectionId: connection } }),
  },
  providers: {
    list: async (): Promise<ProviderRow[]> => [{ computer: LOCAL, online: true, providers: (await request({ schema: PROVIDER_LIST, path: '/api/providers' })).data }],
    connect: ({ id, apiKey }: { id: ProviderId; apiKey: string; computers?: string[] }): Promise<Provider> => request({ schema: Provider, path: providerPath(id), method: 'PATCH', body: { apiKey } }),
    refresh: (id: ProviderId): Promise<Provider> => request({ schema: Provider, path: `${providerPath(id)}/refresh`, method: 'POST' }),
    setModels: ({ id, models }: { id: ProviderId; models: { id: string; on: boolean }[] }): Promise<Provider> => request({ schema: Provider, path: providerPath(id), method: 'PATCH', body: { models } }),
    disconnect: (id: ProviderId): Promise<Provider> => request({ schema: Provider, path: providerPath(id), method: 'DELETE' }),
  },
  computers: {
    async list(): Promise<Computer[]> {
      const admin = await request({ schema: Admin, path: '/api/admin' }).catch(() => undefined)
      const appTooOld = !!APP_VERSION && !!admin?.minAppVersion && older({ version: APP_VERSION, than: admin.minAppVersion })
      return [{ id: LOCAL, name: WORDS.thisComputer, url: '', online: !!admin, features: admin?.features ?? { whatsapp: false, browser: false }, appTooOld, runtimeTooOld: false }]
    },
    async add(peer: TailnetPeer): Promise<unknown> {
      if (!bridge?.computers) throw new Error('Open the OpenHut app on this computer to do this.')
      const { code } = await request({ schema: JoinCode, path: '/api/cloud/join-codes', method: 'POST' })
      return bridge.computers.add({ peer, join: code })
    },
  },
  account: {
    me: (): Promise<Me> => request({ schema: Me, path: '/api/me' }),
  },
}

export const enrollments = {
  list: async (): Promise<Enrollment[]> => await bridge?.computers?.enrollments() ?? [],
  dismiss: (dns: string) => bridge?.computers?.dismiss({ dns }),
  follow: (listener: (list: Enrollment[]) => void) => bridge?.computers?.onEnrollments(listener),
}

export function mergeProviders(rows: ProviderRow[]): (Provider & { computers: string[] })[] {
  return PROVIDERS.flatMap((info) => {
    const have = rows.filter((row) => row.online && row.providers.some((each) => each.id === info.id && each.connected))
    const lead = have[0]?.providers.find((each) => each.id === info.id) ?? rows.flatMap((row) => row.providers).find((each) => each.id === info.id)
    return lead ? [{ ...lead, computers: have.map((row) => row.computer) }] : []
  })
}

function here(agent: Agent): OpenHutAgent {
  return { ...agent, computer: LOCAL, online: true }
}

function providerPath(id: ProviderId): string {
  return `/api/providers/${id}`
}

function older({ version, than }: { version: string; than: string }): boolean {
  const [a, b] = [version, than].map((each) => each.split(/[.-]/).slice(0, 3).map(Number))
  const at = a.findIndex((part, index) => part !== b[index])
  return at >= 0 && a[at] < b[at]
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
