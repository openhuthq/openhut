import * as z from 'zod/mini'
import { providerInfo, type ProviderId } from '@openhut/common/models/provider.ts'
import { log } from '../../platform/events.ts'
import { HttpError, messageOf } from '../../platform/http-error.ts'
import { settings } from '../../platform/settings.ts'
import type { Upstream } from '../../gateway/broker.ts'

const TIMEOUT_MS = 20_000
const KEYED_PATHS = new Set(['POST /v1/chat/completions', 'POST /v1/responses', 'GET /v1/models'])

export type ListedModel = { id: string; name: string; note: string | null; contextLength: number | null; inputPrice: number | null; outputPrice: number | null; created: number | null }
export type Route = { provider: string; model: string; baseUrl?: string; apiKey?: string; contextLength?: number | null }
export type Setup = { env: string[]; yaml: string; auth?: object }
export type Provider = {
  id: ProviderId
  seed: ListedModel[]
  connected: () => boolean
  listModels: (key?: string) => Promise<ListedModel[]>
  upstream: Upstream
  route: (ctx: { gateway: string; token: string; model: string; contextLength: number | null }) => Route
  setup: (ctx: { gateway: string; token: string }) => Setup
}

export const listed = (id: string, extra: Partial<ListedModel> = {}): ListedModel => ({ id, name: id, note: null, contextLength: null, inputPrice: null, outputPrice: null, created: null, ...extra })

export function keyed({ id, origin, listModels }: { id: ProviderId; origin: string; listModels: (key: string) => Promise<ListedModel[]> }): Provider {
  return {
    id,
    seed: [],
    connected: () => !!settings.providerKey(id),
    listModels: (key) => listModels(key ?? settings.providerKey(id)),
    upstream: {
      name: id,
      origin,
      allow: ({ method, path }) => KEYED_PATHS.has(`${method} ${path}`),
      credential: async () => settings.providerKey(id) || refuse(`${providerInfo(id).name} isn't connected on this computer. Add its key under Settings, Models.`),
      apply: ({ out, secret }) => out.headers.set('authorization', `Bearer ${secret}`),
    },
    route: ({ gateway, token, model, contextLength }) => ({ provider: 'custom', model, baseUrl: `${gateway}/u/${id}/v1`, apiKey: token, contextLength }),
    setup: () => ({ env: [], yaml: '' }),
  }
}

export async function getJson({ id, url, key, account }: { id: ProviderId; url: string; key: string; account?: string }): Promise<unknown> {
  const { name, short } = providerInfo(id)
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, accept: 'application/json' }
  if (account) headers['chatgpt-account-id'] = account
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    .catch((err: unknown) => {
      log.warn({ event: 'provider.unreachable', provider: id, error: messageOf(err) })
      throw new HttpError(502, `${name} didn't answer. Check your connection and try again.`)
    })
  if (res.status === 401 || res.status === 403) throw new HttpError(400, `${short} refused that key. Check it and try again.`, { param: 'apiKey' })
  if (!res.ok) throw new HttpError(502, `${name} answered ${res.status} when asked for its models. Try again in a minute.`)
  return res.json().catch(() => { throw new HttpError(502, `${name} sent a model list the app can't read.`) })
}

export function parse<S extends z.ZodMiniType>({ id, schema, body }: { id: ProviderId; schema: S; body: unknown }): z.output<S> {
  const parsed = z.safeParse(schema, body)
  if (!parsed.success) throw new HttpError(502, `${providerInfo(id).name} sent a models list the app can't read.`)
  return parsed.data
}

export function refuse(message: string): never {
  throw new HttpError(409, message)
}
