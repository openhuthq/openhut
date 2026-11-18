import { PROVIDERS, splitModelKey, type Provider, type ProviderId, type ProviderModel } from '@openhut/common/models/provider.ts'
import type { BrandName } from '@/components/brand-icons'

export const BRAND: Record<ProviderId, BrandName> = { claude: 'claude', codex: 'codex', openrouter: 'openrouter', openai: 'openai', xai: 'xai' }

export const infoOf = (id: ProviderId) => PROVIDERS.find((each) => each.id === id) ?? PROVIDERS[0]

export function context(tokens: number) {
  return tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${Math.round(tokens / 1000)}K`
}

export function describe({ provider, model }: { provider: Provider; model: ProviderModel }) {
  if (provider.kind === 'subscription') return [provider.name, model.note].filter(Boolean).join(' · ')
  const bits: string[] = [infoOf(provider.id).short]
  if (model.contextLength) bits.push(`${context(model.contextLength)} context`)
  if (model.inputPrice !== null && model.outputPrice !== null) bits.push(`$${model.inputPrice} / $${model.outputPrice} per M`)
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

export function automatic({ providers, key }: { providers: Provider[] | undefined; key: string }) {
  const { split, provider } = find({ providers, key })
  const fast = provider?.models.find((each) => each.on && each.tier === 'fast')
  if (!split || !fast || !provider) return { key, name: nameOf({ providers, key }), same: true }
  return { key: `${provider.id}:${fast.id}`, name: fast.name, same: false }
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

type Using = { name: string; model: string; fallbackModel: string | null; helperModels: Record<string, string | null> }

export function consequence({ agents, id }: { agents: Using[]; id: ProviderId }) {
  const uses = (key: string | null | undefined) => !!key?.startsWith(`${id}:`)
  const verb = (names: string[]) => names.length === 1 ? 'uses' : 'use'
  const main = agents.filter((agent) => uses(agent.model)).map((agent) => agent.name)
  const side = agents.filter((agent) => !uses(agent.model) && (uses(agent.fallbackModel) || Object.values(agent.helperModels).some(uses))).map((agent) => agent.name)
  const parts = [
    main.length && `${LIST.format(main)} ${verb(main)} its models, and stop${main.length === 1 ? 's' : ''} answering until you pick others.`,
    side.length && `${LIST.format(side)} ${verb(side)} it as a fallback or helper model, and that part stops working until you pick another.`,
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : 'No agent uses its models yet.'
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
