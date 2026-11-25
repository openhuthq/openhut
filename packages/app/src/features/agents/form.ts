import type { Provider, ProviderId } from '@openhut/common/models/provider.ts'

export const DEFAULT_MODEL = 'claude:sonnet'

export function firstModel(providers: Provider[] | undefined, only?: ProviderId): string | null {
  const ready = providers?.filter((provider) => provider.connected && (!only || provider.id === only)) ?? []
  if (ready.some((provider) => provider.id === 'claude' && provider.models.some((model) => model.id === 'sonnet' && model.on))) return DEFAULT_MODEL
  const found = ready.flatMap((provider) => provider.models.filter((model) => model.on).map((model) => `${provider.id}:${model.id}`))
  return found[0] ?? null
}

export function inUse(providers: Provider[] | undefined): ProviderId | undefined {
  const picked = firstModel(providers)
  return providers?.find((provider) => picked?.startsWith(`${provider.id}:`))?.id
}

export function runsOnChoices<T extends { online: boolean }>(computers: T[] | undefined): T[] {
  return computers?.filter((computer) => computer.online) ?? []
}
