import * as z from 'zod/mini'
import { Timestamp, atLeastOneField } from '../api.ts'

export const ProviderId = z.enum(['claude', 'codex', 'openrouter', 'openai', 'xai'])
export type ProviderId = z.infer<typeof ProviderId>

export const ProviderKind = z.enum(['subscription', 'key'])
export type ProviderKind = z.infer<typeof ProviderKind>

export const KEY_MESSAGE = 'That does not look like a key. Paste the whole thing.'

export const PROVIDERS = [
  { id: 'claude', kind: 'subscription', name: 'Claude subscription', short: 'Claude', blurb: 'Pro or Max', keysAt: null, keyHint: null },
  { id: 'codex', kind: 'subscription', name: 'Codex subscription', short: 'Codex', blurb: 'ChatGPT Plus or Pro', keysAt: null, keyHint: null },
  { id: 'openrouter', kind: 'key', name: 'OpenRouter', short: 'OpenRouter', blurb: 'One key for hundreds of models', keysAt: 'openrouter.ai/keys', keyHint: 'sk-or-v1-…' },
  { id: 'openai', kind: 'key', name: 'OpenAI', short: 'OpenAI', blurb: 'GPT models with your OpenAI key', keysAt: 'platform.openai.com/api-keys', keyHint: 'sk-…' },
  { id: 'xai', kind: 'key', name: 'xAI', short: 'xAI', blurb: 'Grok models with your xAI key', keysAt: 'console.x.ai', keyHint: 'xai-…' },
] as const satisfies readonly { id: ProviderId; kind: ProviderKind; name: string; short: string; blurb: string; keysAt: string | null; keyHint: string | null }[]

export type ProviderInfo = (typeof PROVIDERS)[number]

export const providerInfo = (id: ProviderId): ProviderInfo => PROVIDERS.find((each) => each.id === id) ?? PROVIDERS[0]

export const ModelKey = z.string().check(z.regex(/^(claude|codex|openrouter|openai|xai):\S{1,200}$/, 'Use provider:model, like claude:sonnet.'))
export type ModelKey = z.infer<typeof ModelKey>

export const LEGACY_MODELS: Record<string, ModelKey> = { opus: 'claude:opus', sonnet: 'claude:sonnet', haiku: 'claude:haiku', codex: 'codex:gpt-5.5' }

export function splitModelKey(key: string): { provider: ProviderId; model: string } | undefined {
  const full = LEGACY_MODELS[key] ?? key
  const at = full.indexOf(':')
  const provider = ProviderId.safeParse(full.slice(0, at))
  return at > 0 && provider.success && full.length > at + 1 ? { provider: provider.data, model: full.slice(at + 1) } : undefined
}

export const modelKey = ({ provider, model }: { provider: ProviderId; model: string }): ModelKey => `${provider}:${model}`

export const ProviderModel = z.object({
  id: z.string(),
  name: z.string(),
  on: z.boolean(),
  tier: z.enum(['big', 'fast']),
  note: z.nullable(z.string()),
  contextLength: z.nullable(z.number()),
  inputPrice: z.nullable(z.number()),
  outputPrice: z.nullable(z.number()),
})
export type ProviderModel = z.infer<typeof ProviderModel>

export const fastModelOf = (models: ProviderModel[]) => models.find((model) => model.on && model.tier === 'fast')

export const Provider = z.object({
  id: ProviderId,
  object: z.literal('provider'),
  kind: ProviderKind,
  name: z.string(),
  connected: z.boolean(),
  keyHint: z.nullable(z.string()),
  updatedAt: z.nullable(Timestamp),
  models: z.array(ProviderModel),
})
export type Provider = z.infer<typeof Provider>

export const UpdateProvider = z.object({
  apiKey: z.optional(z.string().check(z.regex(/^\S{8,400}$/, KEY_MESSAGE))),
  models: z.optional(z.array(z.object({ id: z.string().check(z.maxLength(200)), on: z.boolean() })).check(z.maxLength(2000))),
}).check(atLeastOneField)
export type UpdateProvider = z.infer<typeof UpdateProvider>

export const ProviderParams = z.object({ id: ProviderId })
export type ProviderParams = z.infer<typeof ProviderParams>
