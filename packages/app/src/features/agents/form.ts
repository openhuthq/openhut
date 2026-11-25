import type { Provider, ProviderId } from '@openhut/common/models/provider.ts'
import type { Computer } from '@/lib/openhut'
import { nameOf } from '../cloud/seen.ts'

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

export function defaultComputer(computers: Pick<Computer, 'id' | 'kind' | 'online'>[]): string {
  return computers.find((each) => each.kind === 'server' && each.online)?.id ?? 'local'
}

export type PeopleSearch = { kind: 'none'; query: string } | { kind: 'found'; emails: string[] }

export function searchPeople({ members, owner, query }: { members: readonly string[]; owner: string; query: string }): PeopleSearch {
  const typed = query.trim().toLowerCase()
  const emails = members.filter((email) => email !== owner && email.toLowerCase().includes(typed))
  return typed && !emails.length ? { kind: 'none', query: query.trim() } : { kind: 'found', emails }
}

export const looksLikeEmail = (text: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)

export function previewOf({ owner, people }: { owner: string; people: readonly string[] }): { faces: string[]; text: string; label: string } {
  const faces = [owner, ...people].slice(0, 3)
  if (!people.length) return { faces, text: 'Only you', label: 'Only you' }
  if (people.length > 3) return { faces, text: `+${people.length + 1 - faces.length}`, label: `You and ${people.length} more` }
  const names = ['You', ...people.map(nameOf)]
  const text = `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return { faces, text, label: text }
}

export type AccessValue = { shared: boolean; people: string[]; sidebars: string[] }

export const ONLY_YOU: AccessValue = { shared: false, people: [], sidebars: [] }

export const withWholeTeam = (value: AccessValue, on: boolean): AccessValue => ({ ...value, shared: on, sidebars: [] })

export const accessLabel = ({ value, owner, team }: { value: AccessValue; owner: string; team: string }) => value.shared ? `Everyone on ${team}` : previewOf({ owner, people: value.people }).label
