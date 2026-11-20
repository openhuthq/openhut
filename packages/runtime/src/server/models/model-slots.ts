import { splitModelKey, type ProviderId, type ProviderModel } from '@openhut/common/models/provider.ts'

const DEFAULT_SLOT: Slot = { provider: 'claude', model: 'sonnet', contextLength: null }

export type Slot = { provider: ProviderId; model: string; contextLength: number | null }
export type Slots = { primary: Slot }
export type Catalog = (provider: ProviderId) => ProviderModel[]

export function resolveSlots({ model, catalog }: { model: string; catalog: Catalog }): Slots {
  return { primary: slotOf({ key: model, catalog }) ?? DEFAULT_SLOT }
}

function slotOf({ key, catalog }: { key: string; catalog: Catalog }): Slot | undefined {
  const split = splitModelKey(key)
  if (!split) return undefined
  return { ...split, contextLength: catalog(split.provider).find((model) => model.id === split.model)?.contextLength ?? null }
}
