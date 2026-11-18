import { fastModelOf, splitModelKey, type ProviderId, type ProviderModel } from '@openhut/common/models/provider.ts'
import type { HelperModels, HelperSlot } from '@openhut/common/agents/agent.ts'

const DEFAULT_SLOT: Slot = { provider: 'claude', model: 'sonnet', contextLength: null }

export type Slot = { provider: ProviderId; model: string; contextLength: number | null }
export type Slots = { primary: Slot; fallback: Slot | null; helpers: Record<HelperSlot | 'approval', Slot> }
export type Catalog = (provider: ProviderId) => ProviderModel[]

export function resolveSlots({ model, fallback, helpers, catalog }: { model: string; fallback: string | null; helpers: Partial<HelperModels>; catalog: Catalog }): Slots {
  const primary = slotOf({ key: model, catalog }) ?? DEFAULT_SLOT
  const automatic = autoFor({ primary, catalog })
  const helper = (key: string | null | undefined) => (key ? slotOf({ key, catalog }) : undefined) ?? automatic
  return {
    primary,
    fallback: fallback ? slotOf({ key: fallback, catalog }) ?? null : null,
    helpers: { compress: helper(helpers.compress), title: helper(helpers.title), review: helper(helpers.review), approval: automatic },
  }
}

export function autoFor({ primary, catalog }: { primary: Slot; catalog: Catalog }): Slot {
  const fast = fastModelOf(catalog(primary.provider))
  return fast ? { provider: primary.provider, model: fast.id, contextLength: fast.contextLength } : primary
}

function slotOf({ key, catalog }: { key: string; catalog: Catalog }): Slot | undefined {
  const split = splitModelKey(key)
  if (!split) return undefined
  return { ...split, contextLength: catalog(split.provider).find((model) => model.id === split.model)?.contextLength ?? null }
}
