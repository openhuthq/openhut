import type { Provider, ProviderId } from '@openhut/common/models/provider.ts'
import type { Computer } from '@/lib/openhut'

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

// Where a new agent runs unless the person picks another: the always-on Linux server when one is online, else this computer.
export function defaultComputer(computers: Pick<Computer, 'id' | 'kind' | 'online'>[]): string {
  return computers.find((each) => each.kind === 'server' && each.online)?.id ?? 'local'
}

export type PeopleSearch = { kind: 'none'; query: string } | { kind: 'found'; emails: string[] }

// The people a Share field offers: teammates other than the owner and those already added, matched on email or name.
export function searchPeople({ members, owner, added, query }: { members: readonly string[]; owner: string; added: readonly string[]; query: string }): PeopleSearch {
  const typed = query.trim().toLowerCase()
  const emails = members.filter((email) => email !== owner && !added.includes(email) && email.toLowerCase().includes(typed))
  return typed && !emails.length ? { kind: 'none', query: query.trim() } : { kind: 'found', emails }
}

export const looksLikeEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
