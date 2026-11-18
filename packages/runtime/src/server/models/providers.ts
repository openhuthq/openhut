import * as z from 'zod/mini'
import { PROVIDERS, type ProviderId } from '@openhut/common/models/provider.ts'
import { config } from '../platform/config.ts'
import { log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { settings } from '../platform/settings.ts'
import { seatLimits } from '../admin/seat-limits.ts'
import { codex } from '../integrations/codex/codex.ts'
import type { Upstream } from '../gateway/broker.ts'

const TIMEOUT_MS = 20_000
const PER_MILLION = 1_000_000
const FAST_NAME = /mini|nano|flash|haiku|lite|small|fast/i
const NOT_CHAT = /image|imagine|dall-e|embed|whisper|tts|transcribe|audio|realtime|moderation|video|sora|babbage|davinci|search-preview|computer-use/i
const CLAUDE_PLUGIN = 'claude-subscription-directsdk-experimental'
const CODEX_FALLBACK = 'gpt-5.5'
const KEYED_PATHS = new Set(['POST /v1/chat/completions', 'POST /v1/responses', 'GET /v1/models'])
const Created = z.optional(z.number())
const OpenAiList = z.object({ data: z.array(z.object({ id: z.string(), created: Created })) })
const Price = z.optional(z.nullable(z.string()))
const OpenRouterList = z.object({
  data: z.array(z.object({
    id: z.string(), name: z.optional(z.string()), created: Created, context_length: z.optional(z.nullable(z.number())),
    pricing: z.optional(z.object({ prompt: Price, completion: Price })),
    architecture: z.optional(z.object({ output_modalities: z.optional(z.array(z.string())) })),
  })),
})
const CodexList = z.object({ models: z.array(z.object({ slug: z.string(), display_name: z.optional(z.nullable(z.string())), context_window: z.optional(z.nullable(z.number())), visibility: z.optional(z.nullable(z.string())) })) })

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

const listed = (id: string, extra: Partial<ListedModel> = {}): ListedModel => ({ id, name: id, note: null, contextLength: null, inputPrice: null, outputPrice: null, created: null, ...extra })
const nameOf = (id: ProviderId) => PROVIDERS.find((each) => each.id === id)?.name ?? id
const shortOf = (id: ProviderId) => PROVIDERS.find((each) => each.id === id)?.short ?? id

export const providers: Record<ProviderId, Provider> = {
  claude: {
    id: 'claude',
    seed: [
      listed('opus', { name: 'Opus 5.5', note: 'Most capable' }),
      listed('sonnet', { name: 'Sonnet 5.5', note: 'Fast and capable' }),
      listed('haiku', { name: 'Haiku 5.5', note: 'Fastest' }),
    ],
    connected: () => config.modelMode === 'test' || !!settings.seatToken(),
    listModels: async () => providers.claude.seed,
    upstream: {
      name: 'anthropic',
      origin: config.anthropicApi,
      allow: ({ method, path }) => method === 'POST' && (path === '/v1/messages' || path === '/v1/messages/count_tokens'),
      credential: async () => settings.seatToken() || refuse('No Claude seat is connected. An owner or admin connects one in Admin.'),
      apply: ({ out, secret }) => out.headers.set('authorization', `Bearer ${secret}`),
      observe: (headers) => seatLimits.observe(headers),
    },
    route: ({ model }) => ({ provider: CLAUDE_PLUGIN, model }),
    setup: ({ gateway, token }) => ({
      env: [`CLAUDE_CODE_OAUTH_TOKEN=${token}`],
      yaml: `plugins:\n  entries:\n    ${CLAUDE_PLUGIN}:\n      settings:\n        relay_upstream: ${gateway}/u/anthropic`,
    }),
  },
  codex: {
    id: 'codex',
    seed: [listed(CODEX_FALLBACK, { name: 'GPT-5.5', note: 'Most capable' })],
    connected: () => !!settings.codexTokens(),
    listModels: async () => codexModels().catch(() => providers.codex.seed),
    upstream: {
      name: 'codex',
      origin: config.codexApi,
      allow: ({ method, path }) => (method === 'POST' && (path === '/responses' || path === '/responses/compact')) || (method === 'GET' && path === '/models'),
      credential: () => codex.accessToken(),
      apply: ({ out, secret }) => {
        out.headers.set('authorization', `Bearer ${secret}`)
        const account = codex.accountOf(secret)
        if (account) out.headers.set('chatgpt-account-id', account)
      },
    },
    route: ({ model }) => ({ provider: 'openai-codex', model }),
    setup: ({ gateway, token }) => ({
      env: [`HERMES_CODEX_BASE_URL=${gateway}/u/codex`],
      yaml: '',
      auth: { version: 1, active_provider: 'openai-codex', providers: { 'openai-codex': { auth_mode: 'chatgpt', tokens: { access_token: token, refresh_token: 'held-by-the-gateway' } } } },
    }),
  },
  openrouter: keyed({ id: 'openrouter', origin: config.openrouterApi, listModels: openRouterModels }),
  openai: keyed({ id: 'openai', origin: config.openaiApi, listModels: (key) => openAiModels({ id: 'openai', origin: config.openaiApi, key }) }),
  xai: keyed({ id: 'xai', origin: config.xaiApi, listModels: (key) => openAiModels({ id: 'xai', origin: config.xaiApi, key }) }),
}

export function tierOf(id: string): 'big' | 'fast' {
  return FAST_NAME.test(id) ? 'fast' : 'big'
}

function keyed({ id, origin, listModels }: { id: ProviderId; origin: string; listModels: (key: string) => Promise<ListedModel[]> }): Provider {
  return {
    id,
    seed: [],
    connected: () => !!settings.providerKey(id),
    listModels: (key) => listModels(key ?? settings.providerKey(id)),
    upstream: {
      name: id,
      origin,
      allow: ({ method, path }) => KEYED_PATHS.has(`${method} ${path}`),
      credential: async () => settings.providerKey(id) || refuse(`${nameOf(id)} isn't connected on this computer. Add its key under Settings, Models.`),
      apply: ({ out, secret }) => out.headers.set('authorization', `Bearer ${secret}`),
    },
    route: ({ gateway, token, model, contextLength }) => ({ provider: 'custom', model, baseUrl: `${gateway}/u/${id}/v1`, apiKey: token, contextLength }),
    setup: () => ({ env: [], yaml: '' }),
  }
}

async function openAiModels({ id, origin, key }: { id: ProviderId; origin: string; key: string }): Promise<ListedModel[]> {
  const list = parse({ id, what: 'models', schema: OpenAiList, body: await getJson({ id, url: `${origin}/v1/models`, key }) })
  return list.data.filter((model) => !NOT_CHAT.test(model.id)).map((model) => listed(model.id, { created: model.created ?? null }))
}

async function openRouterModels(key: string): Promise<ListedModel[]> {
  await getJson({ id: 'openrouter', url: `${config.openrouterApi}/v1/key`, key })
  const list = parse({ id: 'openrouter', what: 'models', schema: OpenRouterList, body: await getJson({ id: 'openrouter', url: `${config.openrouterApi}/v1/models`, key }) })
  return list.data
    .filter((model) => model.architecture?.output_modalities?.includes('text') ?? true)
    .map((model) => listed(model.id, {
      name: model.name || model.id, created: model.created ?? null, contextLength: model.context_length ?? null,
      inputPrice: perMillion(model.pricing?.prompt), outputPrice: perMillion(model.pricing?.completion),
    }))
}

async function codexModels(): Promise<ListedModel[]> {
  const key = await codex.accessToken()
  const list = parse({ id: 'codex', what: 'models', schema: CodexList, body: await getJson({ id: 'codex', url: `${config.codexApi}/models?client_version=1.0.0`, key, account: codex.accountOf(key) }) })
  const found = list.models.filter((model) => model.visibility !== 'hide').map((model) => listed(model.slug, { name: model.display_name || model.slug, contextLength: model.context_window ?? null }))
  if (!found.length) throw new HttpError(502, 'ChatGPT listed no models.')
  return found
}

function perMillion(price: string | null | undefined): number | null {
  const value = Number(price)
  return price && Number.isFinite(value) && value >= 0 ? Math.round(value * PER_MILLION * 1000) / 1000 : null
}

async function getJson({ id, url, key, account }: { id: ProviderId; url: string; key: string; account?: string }): Promise<unknown> {
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, accept: 'application/json' }
  if (account) headers['chatgpt-account-id'] = account
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) })
    .catch((err: unknown) => {
      log.warn({ event: 'provider.unreachable', provider: id, error: messageOf(err) })
      throw new HttpError(502, `${nameOf(id)} didn't answer. Check your connection and try again.`)
    })
  if (res.status === 401 || res.status === 403) throw new HttpError(400, `${shortOf(id)} refused that key. Check it and try again.`, { param: 'apiKey' })
  if (!res.ok) throw new HttpError(502, `${nameOf(id)} answered ${res.status} when asked for its models. Try again in a minute.`)
  return res.json().catch(() => { throw new HttpError(502, `${nameOf(id)} sent a model list the app can't read.`) })
}

function parse<S extends z.ZodMiniType>({ id, what, schema, body }: { id: ProviderId; what: string; schema: S; body: unknown }): z.output<S> {
  const parsed = z.safeParse(schema, body)
  if (!parsed.success) throw new HttpError(502, `${nameOf(id)} sent a ${what} list the app can't read.`)
  return parsed.data
}

function refuse(message: string): never {
  throw new HttpError(409, message)
}
