import type { Provider, ProviderId } from '@openhut/common/models/provider.ts'
import type { Computer } from '@/lib/openhut'

export const DEFAULT_MODEL = 'claude:sonnet'

export function firstModel(providers: Provider[] | undefined, only?: ProviderId): string | null {
  const ready = providers?.filter((provider) => provider.connected && (!only || provider.id === only)) ?? []
  if (ready.some((provider) => provider.id === 'claude' && provider.models.some((model) => model.id === 'sonnet' && model.on))) return DEFAULT_MODEL
  const found = ready.flatMap((provider) => provider.models.filter((model) => model.on).map((model) => `${provider.id}:${model.id}`))
  return found[0] ?? null
}

export function noteOf({ where, computers, here }: { where: Pick<Computer, 'kind' | 'server'>; computers: Pick<Computer, 'kind'>[]; here: string }): string {
  if (where.kind === 'server' || where.server) return 'Sealed in its own box. Can’t see your files.'
  if (where.kind === 'desktop') return 'Runs as you on that computer, while it’s awake.'
  const sealed = computers.some((each) => each.kind === 'server') ? 'Pick your Linux server to seal it in its own box.' : 'Add a Linux server in Settings › Computers to seal it in its own box.'
  return `It runs like any app you install, with your access, while this ${here} is awake. ${sealed}`
}
