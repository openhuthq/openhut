import type { CreditModel, Credits } from '@openhut/common/cloud/v1/identity.ts'
import { cloud } from '../../platform/cloud.ts'
import { config } from '../../platform/config.ts'
import { keyed, listed, refuse, type ListedModel, type Provider } from './shared.ts'

export const MAX_OUTPUT = 8_192
export const MAX_CONTEXT = 200_000
const FRESH_MS = 5 * 60_000 // how often the Cloud computer re-reads its key and the model list
const OUT = 'Your OpenHut credits are used up. Ask your admin for more, or add your own key under Settings, Models.'

// The Cloud's default list, until the first read (its admin setting inference.models can change it). $ per million tokens.
const MODELS: CreditModel[] = [
  { id: 'deepseek/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', inputPrice: 0.14, outputPrice: 0.42 },
  { id: 'openai/gpt-6-luna', name: 'GPT-6 Luna', inputPrice: 0.1, outputPrice: 0.5 },
  { id: 'x-ai/grok-4.7', name: 'Grok 4.7', inputPrice: 2, outputPrice: 6 },
  { id: 'google/gemini-4-neon', name: 'Gemini 4 Neon', inputPrice: 3, outputPrice: 15 },
  { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', inputPrice: 4, outputPrice: 20 },
  { id: 'z-ai/glm-5.3-flash', name: 'GLM 5.3 Flash', inputPrice: 0.12, outputPrice: 0.38 },
]

const credits: { at: number; value?: Credits } = { at: 0 }

async function current(): Promise<Credits | undefined> {
  if (Date.now() - credits.at > FRESH_MS) {
    credits.at = Date.now()
    credits.value = await cloud.credits().catch(() => credits.value)
  }
  return credits.value
}

const listedOf = ({ id, name, inputPrice, outputPrice }: CreditModel): ListedModel => listed(id, { name, contextLength: MAX_CONTEXT, inputPrice, outputPrice })

// The usual keyed() provider over OpenRouter, but the key comes from OpenHut Cloud (only the Cloud computer gets it) and
// stays in the gateway: agents get their gateway token. Every request is capped at 200k context and 8,192 output tokens.
const base = keyed({ id: 'openhut', origin: config.openrouterApi, listModels: async () => ((await current())?.models ?? MODELS).map(listedOf) })
export const openhut: Provider = {
  ...base,
  seed: MODELS.map(listedOf),
  // The first ask starts the read, so a Cloud computer shows OpenHut as connected a moment later.
  connected: () => {
    void current()
    return !!credits.value?.key
  },
  upstream: {
    ...base.upstream,
    credential: async () => (await current())?.key ?? refuse(OUT),
    body: (json) => ({ ...json, max_tokens: Math.min(Number(json.max_tokens) || MAX_OUTPUT, MAX_OUTPUT), max_completion_tokens: undefined, max_output_tokens: undefined }),
  },
  route: (ctx) => base.route({ ...ctx, contextLength: Math.min(ctx.contextLength ?? MAX_CONTEXT, MAX_CONTEXT) }),
}
