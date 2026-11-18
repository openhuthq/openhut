import * as z from 'zod/mini'
import type { ProviderId } from '@openhut/common/models/provider.ts'
import { config } from '../../platform/config.ts'
import { getJson, keyed, listed, parse, type ListedModel } from './shared.ts'

const NOT_CHAT = /image|imagine|dall-e|embed|whisper|tts|transcribe|audio|realtime|moderation|video|sora|babbage|davinci|search-preview|computer-use/i
const OpenAiList = z.object({ data: z.array(z.object({ id: z.string(), created: z.optional(z.number()) })) })

export const openai = keyed({ id: 'openai', origin: config.openaiApi, listModels: (key) => openAiModels({ id: 'openai', origin: config.openaiApi, key }) })

export async function openAiModels({ id, origin, key }: { id: ProviderId; origin: string; key: string }): Promise<ListedModel[]> {
  const list = parse({ id, schema: OpenAiList, body: await getJson({ id, url: `${origin}/v1/models`, key }) })
  return list.data.filter((model) => !NOT_CHAT.test(model.id)).map((model) => listed(model.id, { created: model.created ?? null }))
}
