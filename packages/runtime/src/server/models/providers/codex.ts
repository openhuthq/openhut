import * as z from 'zod/mini'
import { config } from '../../platform/config.ts'
import { HttpError } from '../../platform/http-error.ts'
import { settings } from '../../platform/settings.ts'
import { codex as chatgpt } from '../../integrations/codex/codex.ts'
import { getJson, listed, parse, type ListedModel, type Provider } from './shared.ts'

const SEED = [listed('gpt-5.5', { name: 'GPT-5.5', note: 'Most capable' })]
const CodexList = z.object({ models: z.array(z.object({ slug: z.string(), display_name: z.optional(z.nullable(z.string())), context_window: z.optional(z.nullable(z.number())), visibility: z.optional(z.nullable(z.string())) })) })

export const codex: Provider = {
  id: 'codex',
  seed: SEED,
  connected: () => !!settings.codexTokens(),
  listModels: async () => listModels().catch(() => SEED),
  upstream: {
    name: 'codex',
    origin: config.codexApi,
    allow: ({ method, path }) => (method === 'POST' && (path === '/responses' || path === '/responses/compact')) || (method === 'GET' && path === '/models'),
    credential: () => chatgpt.accessToken(),
    apply: ({ out, secret }) => {
      out.headers.set('authorization', `Bearer ${secret}`)
      const account = chatgpt.accountOf(secret)
      if (account) out.headers.set('chatgpt-account-id', account)
    },
  },
  route: ({ model }) => ({ provider: 'openai-codex', model }),
  setup: ({ gateway, token }) => ({
    env: [`HERMES_CODEX_BASE_URL=${gateway}/u/codex`],
    yaml: '',
    auth: { version: 1, active_provider: 'openai-codex', providers: { 'openai-codex': { auth_mode: 'chatgpt', tokens: { access_token: token, refresh_token: 'held-by-the-gateway' } } } },
  }),
}

async function listModels(): Promise<ListedModel[]> {
  const key = await chatgpt.accessToken()
  const list = parse({ id: 'codex', schema: CodexList, body: await getJson({ id: 'codex', url: `${config.codexApi}/models?client_version=1.0.0`, key, account: chatgpt.accountOf(key) }) })
  const found = list.models.filter((model) => model.visibility !== 'hide').map((model) => listed(model.slug, { name: model.display_name || model.slug, contextLength: model.context_window ?? null }))
  if (!found.length) throw new HttpError(502, 'ChatGPT listed no models.')
  return found
}
