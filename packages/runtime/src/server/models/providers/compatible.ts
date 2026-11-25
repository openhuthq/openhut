import * as z from 'zod/mini'
import { settings } from '../../platform/settings.ts'
import { getJson, keyed, listed, parse, type Provider } from './shared.ts'

const ModelList = z.object({ data: z.array(z.object({ id: z.string(), created: z.optional(z.number()) })) })
const base = (): string => settings.providerBaseUrl('compatible').replace(/\/+$/, '')
const keyedCompatible = keyed({
  id: 'compatible',
  origin: '',
  listModels: async (key) => parse({ id: 'compatible', schema: ModelList, body: await getJson({ id: 'compatible', url: `${base()}/models`, key }) })
    .data.map((model) => listed(model.id, { created: model.created ?? null })),
})

export const compatible: Provider = {
  ...keyedCompatible,
  upstream: {
    ...keyedCompatible.upstream,
    get origin() { return base() },
    apply: ({ out, secret }) => {
      out.path = out.path.replace(/^\/v1/, '')
      out.headers.set('authorization', `Bearer ${secret}`)
    },
  },
}
