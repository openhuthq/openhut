import { PROVIDERS, providerInfo, splitModelKey, type Provider, type ProviderId, type ProviderModel, type UpdateProvider } from '@openhut/common/models/provider.ts'
import { HttpError } from '../platform/http-error.ts'
import { emit } from '../platform/events.ts'
import { settings, type StoredCatalog } from '../platform/settings.ts'
import type { Caller } from '../team/identity.ts'
import { providers, tierOf, type ListedModel } from './providers/index.ts'

const FIRST_ON = 8

export const providerService = {
  list(): Provider[] {
    return PROVIDERS.map((info) => providerOf(info.id))
  },

  get({ id }: { id: ProviderId }): Provider {
    return providerOf(id)
  },

  connected: (id: ProviderId): boolean => providers[id].connected(),

  catalog: (id: ProviderId): ProviderModel[] => catalogOf(id).models,

  requireUsable({ key, param }: { key: string; param: string }): void {
    const split = splitModelKey(key)
    if (!split) throw new HttpError(400, 'Use provider:model, like claude:sonnet.', { param })
    const provider = providerOf(split.provider)
    if (!provider.connected) throw new HttpError(409, `${provider.name} isn't connected on this computer. Connect it under Settings, Models first.`, { param })
    const model = provider.models.find((each) => each.id === split.model)
    if (!model) throw new HttpError(409, `${provider.name} doesn't list ${split.model}. Refresh its models under Settings, Models.`, { param })
    if (!model.on) throw new HttpError(409, `${model.name} is switched off. Turn it on under Settings, Models first.`, { param })
  },

  async update({ actor, id, patch }: { actor: Caller; id: ProviderId; patch: UpdateProvider }): Promise<Provider> {
    if (patch.apiKey !== undefined) await connect({ actor, id, key: patch.apiKey })
    if (patch.models) await switchModels({ id, changes: patch.models })
    return providerOf(id)
  },

  async refresh({ id }: { id: ProviderId }): Promise<Provider> {
    requireConnected(id)
    await save({ id, listed: await providers[id].listModels() })
    return providerOf(id)
  },

  async disconnect({ actor, id }: { actor: Caller; id: ProviderId }): Promise<Provider> {
    if (id === 'claude') await settings.forgetSeat()
    else if (id === 'codex') await settings.forgetCodex()
    else await settings.forgetProviderKey(id)
    await settings.forgetCatalog(id)
    emit({ name: 'provider.disconnected', actor, target: { type: 'provider', id } })
    return providerOf(id)
  },
}

function providerOf(id: ProviderId): Provider {
  const info = PROVIDERS.find((each) => each.id === id)
  if (!info) throw new HttpError(404, 'There is no such model provider.')
  const connected = providers[id].connected()
  const stored = settings.catalog(id)
  const key = info.kind === 'key' ? settings.providerKey(id) : ''
  const signedInAt = id === 'claude' ? settings.seatAt() : settings.codexAt()
  return {
    id, object: 'provider', kind: info.kind, name: info.name, connected,
    keyHint: key ? `${key.slice(0, 5)}…${key.slice(-4)}` : null,
    updatedAt: connected ? stored?.at ?? signedInAt : null,
    models: connected ? catalogOf(id).models : [],
  }
}

function catalogOf(id: ProviderId): StoredCatalog {
  return settings.catalog(id) ?? { at: new Date(0).toISOString(), models: build({ listed: providers[id].seed, previous: undefined, firstOn: new Set(providers[id].seed.map((model) => model.id)) }) }
}

async function connect({ actor, id, key }: { actor: Caller; id: ProviderId; key: string }): Promise<void> {
  const info = PROVIDERS.find((each) => each.id === id)
  if (info?.kind !== 'key') throw new HttpError(409, `${info?.short ?? 'That provider'} signs in with an account, not a key.`, { param: 'apiKey' })
  const found = await providers[id].listModels(key)
  if (!found.length) throw new HttpError(409, `${info.short} accepted that key but lists no chat models for it.`, { param: 'apiKey' })
  await settings.setProviderKey(id, key)
  await save({ id, listed: found })
  emit({ name: 'provider.connected', actor, target: { type: 'provider', id } })
}

async function save({ id, listed }: { id: ProviderId; listed: ListedModel[] }): Promise<void> {
  const previous = settings.catalog(id)
  await settings.setCatalog(id, { at: new Date().toISOString(), models: build({ listed, previous: previous?.models, firstOn: firstOn({ id, listed }) }) })
}

async function switchModels({ id, changes }: { id: ProviderId; changes: { id: string; on: boolean }[] }): Promise<void> {
  requireConnected(id)
  const current = catalogOf(id)
  const unknown = changes.find((change) => !current.models.some((model) => model.id === change.id))
  if (unknown) throw new HttpError(400, `${unknown.id} isn't in the list. Refresh the models and try again.`, { param: 'models' })
  const wanted = new Map(changes.map((change) => [change.id, change.on]))
  await settings.setCatalog(id, { at: current.at, models: current.models.map((model) => ({ ...model, on: wanted.get(model.id) ?? model.on })) })
}

function requireConnected(id: ProviderId): void {
  if (!providers[id].connected()) throw new HttpError(409, `${providerInfo(id).short} isn't connected on this computer.`)
}

function firstOn({ id, listed }: { id: ProviderId; listed: ListedModel[] }): Set<string> {
  const starters = new Set(providers[id].starters)
  const picked = listed.filter((model) => starters.has(model.id))
  if (picked.length) return new Set(picked.map((model) => model.id))
  const limit = providerInfo(id).kind === 'key' ? FIRST_ON : Infinity
  return new Set([...listed].sort((a, b) => (b.created ?? 0) - (a.created ?? 0)).slice(0, limit).map((model) => model.id))
}

function build({ listed, previous, firstOn }: { listed: ListedModel[]; previous: ProviderModel[] | undefined; firstOn: Set<string> }): ProviderModel[] {
  return listed.map((model) => ({
    id: model.id, name: model.name, tier: tierOf(model.id), note: model.note,
    contextLength: model.contextLength, inputPrice: model.inputPrice, outputPrice: model.outputPrice,
    on: previous ? previous.find((each) => each.id === model.id)?.on ?? false : firstOn.has(model.id),
  }))
}
