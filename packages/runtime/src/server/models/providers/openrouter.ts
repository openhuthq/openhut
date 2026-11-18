import * as z from 'zod/mini'
import { config } from '../../platform/config.ts'
import { getJson, keyed, listed, parse, type ListedModel } from './shared.ts'

const PER_MILLION = 1_000_000
const Price = z.optional(z.nullable(z.string()))
const OpenRouterList = z.object({
  data: z.array(z.object({
    id: z.string(), name: z.optional(z.string()), created: z.optional(z.number()), context_length: z.optional(z.nullable(z.number())),
    pricing: z.optional(z.object({ prompt: Price, completion: Price })),
    architecture: z.optional(z.object({ output_modalities: z.optional(z.array(z.string())) })),
  })),
})

export const openrouter = keyed({ id: 'openrouter', origin: config.openrouterApi, listModels })

async function listModels(key: string): Promise<ListedModel[]> {
  await getJson({ id: 'openrouter', url: `${config.openrouterApi}/v1/key`, key })
  const list = parse({ id: 'openrouter', schema: OpenRouterList, body: await getJson({ id: 'openrouter', url: `${config.openrouterApi}/v1/models`, key }) })
  return list.data
    .filter((model) => model.architecture?.output_modalities?.includes('text') ?? true)
    .map((model) => listed(model.id, {
      name: model.name || model.id, created: model.created ?? null, contextLength: model.context_length ?? null,
      inputPrice: perMillion(model.pricing?.prompt), outputPrice: perMillion(model.pricing?.completion),
    }))
}

function perMillion(price: string | null | undefined): number | null {
  const value = Number(price)
  return price && Number.isFinite(value) && value >= 0 ? Math.round(value * PER_MILLION * 1000) / 1000 : null
}
