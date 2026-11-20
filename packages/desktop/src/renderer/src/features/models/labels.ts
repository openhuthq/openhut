import { splitModelKey, type Provider, type ProviderId, type ProviderModel } from '@openhut/common/models/provider.ts'
import type { BrandName } from '@/components/brand-icons'

const LABS: Record<string, BrandName> = { anthropic: 'anthropic', openai: 'openai', google: 'gemini', 'x-ai': 'xai', deepseek: 'deepseek', qwen: 'qwen', moonshotai: 'kimi', 'z-ai': 'zai', mistralai: 'mistral', meta: 'meta' }

export const labOf = (model: ProviderModel) => model.id.includes('/') ? model.id.slice(0, model.id.indexOf('/')) : ''

export function glyphOf({ provider, model }: { provider: Provider; model: ProviderModel }): BrandName {
  return provider.id === 'openrouter' ? LABS[labOf(model)] ?? 'openrouter' : provider.id
}

export function money(value: number) {
  if (value >= 10) return `$${Math.round(value)}`
  return value >= 1 ? `$${+value.toFixed(2)}` : `$${+value.toPrecision(2)}`
}

export function prices(model: ProviderModel) {
  return model.inputPrice === null || model.outputPrice === null ? '' : `${money(model.inputPrice)} / ${money(model.outputPrice)}`
}

export function context(tokens: number) {
  return tokens >= 1_000_000 ? `${+(tokens / 1_000_000).toFixed(1)}M` : `${Math.round(tokens / 1000)}K`
}

export function describe({ provider, model }: { provider: Provider; model: ProviderModel }) {
  if (provider.kind === 'subscription') return model.note ?? ''
  const bits: string[] = []
  if (model.contextLength) bits.push(`${context(model.contextLength)} context`)
  if (prices(model)) bits.push(`${prices(model)} per M`)
  return bits.join(' · ')
}

export function find({ providers, key }: { providers: Provider[] | undefined; key: string | null }) {
  const split = key ? splitModelKey(key) : undefined
  const provider = providers?.find((each) => each.id === split?.provider)
  const model = provider?.models.find((each) => each.id === split?.model)
  return { split, provider, model }
}

export function nameOf({ providers, key }: { providers: Provider[] | undefined; key: string }) {
  const { split, model } = find({ providers, key })
  return model?.name ?? split?.model ?? key
}

export function matches({ model, query }: { model: ProviderModel; query: string }) {
  const needle = query.trim().toLowerCase()
  return !needle || `${model.name} ${model.id}`.toLowerCase().includes(needle)
}

const COUNT = new Intl.NumberFormat('en-US')
const LIST = new Intl.ListFormat('en-GB', { type: 'conjunction' })

export const count = (value: number) => COUNT.format(value)

export function plural({ count: value, one, many }: { count: number; one: string; many: string }) {
  return `${count(value)} ${value === 1 ? one : many}`
}

type Using = { name: string; model: string }

export function consequence({ agents, id }: { agents: Using[]; id: ProviderId }) {
  const uses = (key: string | null | undefined) => !!key && splitModelKey(key)?.provider === id
  const verb = (names: string[]) => names.length === 1 ? 'uses' : 'use'
  const main = agents.filter((agent) => uses(agent.model)).map((agent) => agent.name)
  if (!main.length) return 'No agent uses its models yet.'
  return `${LIST.format(main)} ${verb(main)} its models, and stop${main.length === 1 ? 's' : ''} answering until you pick others.`
}

export function foundNotice({ provider }: { provider: Provider | undefined }) {
  const total = provider?.models.length ?? 0
  const on = provider?.models.filter((model) => model.on).length ?? 0
  if (provider?.kind === 'subscription') return `Signed in. ${plural({ count: total, one: 'model', many: 'models' })} found.`
  const switched = on ? `${on} ${on === 1 ? 'is' : 'are'} switched on` : 'None are switched on yet'
  return `Found ${plural({ count: total, one: 'model', many: 'models' })}. ${switched}, turn on the ones agents may use.`
}

export function updatedAgo(iso: string | null) {
  if (!iso) return ''
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (seconds < 90) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} minutes ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)} hours ago`
  return `${Math.round(seconds / 86400)} days ago`
}
