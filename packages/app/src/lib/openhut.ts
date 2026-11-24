import * as z from 'zod/mini'
import { ApiError, List } from '@openhut/common/api.ts'
import { Admin } from '@openhut/common/admin/admin.ts'
import { Agent, Grant } from '@openhut/common/agents/agent.ts'
import { Cloud } from '@openhut/common/cloud/cloud.ts'
import { Me } from '@openhut/common/team/team.ts'
import { WORDS } from '@/lib/platform'
import { desktop } from '@/lib/desktop'
import { remote, REMOTE } from '@/lib/remote'
import { computersOf, type Computer, type Features } from '@/lib/computers'

export type { Computer, Features }
export type TailnetPeer = { name: string; dns: string }
export type Where = { computer?: string; of?: string }
export type OpenHutAgent = Agent & { computer: string; online: boolean }
export type Enrollment = { peer: TailnetPeer; lines: string[]; url: string | null; startedAt: number; status: 'running' | 'failed'; error: string; retryAt: number | null; retried: boolean; waitingAt?: number | null; log?: string }

type Schema<T> = { safeParse: (data: unknown) => { success: true; data: T } | { success: false } }
const LOCAL = 'local'
const AGENT_LIST = List(Agent)
const JoinCode = z.object({ code: z.string() })

export const APP_VERSION = desktop?.version ?? ''

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
  fetch: ({ path, init }: Where & { path: string; init?: RequestInit }): Promise<Response> => REMOTE ? remote.fetch(path, init) : fetch(path, init),
  agents: {
    list: async (): Promise<OpenHutAgent[]> => (await request({ schema: AGENT_LIST, path: '/api/agents' })).data.map(here),
    move: async ({ id, to }: { id: string; to: string }): Promise<OpenHutAgent> =>
      here(await request({ schema: Agent, path: `/api/agents/${encodeURIComponent(id)}`, method: 'PATCH', body: to === LOCAL ? { runsHere: true } : { runsOn: to } })),
  },
  connections: {
    grant: ({ connection, agent }: { connection: string; agent: string }): Promise<Grant> => request({ schema: Grant, path: '/api/grants', method: 'POST', body: { agentId: agent, connectionId: connection } }),
  },
  computers: {
    async list(): Promise<Computer[]> {
      const admin = await request({ schema: Admin, path: '/api/admin' }).catch(() => undefined)
      const appTooOld = !!APP_VERSION && !!admin?.minAppVersion && older({ version: APP_VERSION, than: admin.minAppVersion })
      const cloud = await request({ schema: Cloud, path: '/api/cloud' }).catch(() => undefined)
      return computersOf({ here: { id: LOCAL, name: desktop ? WORDS.thisComputer : 'Your computer', kind: 'here', url: '', online: !!admin, features: admin?.features ?? { whatsapp: false, browser: false }, appTooOld, runtimeTooOld: false }, devices: cloud?.devices ?? [], shell: !!desktop })
    },
    async add(peer: TailnetPeer): Promise<unknown> {
      if (!desktop?.computers) throw new Error('Open the OpenHut app on this computer to do this.')
      const { code } = await request({ schema: JoinCode, path: '/api/cloud/join-codes', method: 'POST' })
      return desktop.computers.add({ peer, join: code })
    },
  },
  account: {
    me: (): Promise<Me> => request({ schema: Me, path: '/api/me' }),
  },
}

export const enrollments = {
  list: async (): Promise<Enrollment[]> => await desktop?.computers?.enrollments() ?? [],
  dismiss: (dns: string) => desktop?.computers?.dismiss({ dns }),
  follow: (listener: (list: Enrollment[]) => void) => desktop?.computers?.onEnrollments(listener),
}

function here(agent: Agent): OpenHutAgent {
  return { ...agent, computer: agent.runsHere || !agent.runsOn ? LOCAL : agent.runsOn, online: true }
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
