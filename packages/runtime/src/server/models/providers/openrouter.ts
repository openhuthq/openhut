import * as z from 'zod/mini'
import { config } from '../../platform/config.ts'
import { getJson, keyed, listed, parse, type ListedModel } from './shared.ts'

const PER_MILLION = 1_000_000
const LAB_PREFIX = /^[^:/]+:\s+/
const Price = z.optional(z.nullable(z.string()))
const OpenRouterList = z.object({
  data: z.array(z.object({
    id: z.string(), name: z.optional(z.string()), created: z.optional(z.number()), context_length: z.optional(z.nullable(z.number())),
    pricing: z.optional(z.object({ prompt: Price, completion: Price })),
    architecture: z.optional(z.object({ output_modalities: z.optional(z.array(z.string())) })),
  })),
})

const STARTERS = [
  'anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5',
  'openai/gpt-6.2-sol', 'openai/gpt-6.1-terra',
  'google/gemini-4-argon', 'google/gemini-3.8-flash',
  'x-ai/grok-4.7',
  'deepseek/deepseek-v4-pro-0813', 'deepseek/deepseek-v4.1-flash',
  'qwen/qwen4-max', 'qwen/qwen3.8-flash',
  'moonshotai/kimi-k3.1-pro',
  'z-ai/glm-5.3', 'z-ai/glm-5.3-flash',
  'mistralai/mistral-large-4-0',
  'meta/muse-spark-1.3', 'meta/muse-ember',
]

export const openrouter = keyed({ id: 'openrouter', origin: config.openrouterApi, listModels, starters: STARTERS })

async function listModels(key: string): Promise<ListedModel[]> {
  await getJson({ id: 'openrouter', url: `${config.openrouterApi}/v1/key`, key })
  const list = parse({ id: 'openrouter', schema: OpenRouterList, body: await getJson({ id: 'openrouter', url: `${config.openrouterApi}/v1/models`, key }) })
  return list.data
    .filter((model) => model.architecture?.output_modalities?.includes('text') ?? true)
    .map((model) => listed(model.id, {
      name: (model.name || model.id).replace(LAB_PREFIX, ''), created: model.created ?? null, contextLength: model.context_length ?? null,
      inputPrice: perMillion(model.pricing?.prompt), outputPrice: perMillion(model.pricing?.completion),
    }))
}

function perMillion(price: string | null | undefined): number | null {
  const value = Number(price)
  return price && Number.isFinite(value) && value >= 0 ? Math.round(value * PER_MILLION * 1000) / 1000 : null
}
