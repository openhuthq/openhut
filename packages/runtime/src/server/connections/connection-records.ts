import { createHmac } from 'node:crypto'
import * as z from 'zod/mini'
import { ConnectionKind } from '@openhut/common/connections/connection.ts'
import { PROVIDERS, ProviderId, ProviderModel } from '@openhut/common/models/provider.ts'
import type { Secret } from '@openhut/common/records/lease.ts'
import { db } from '../platform/db.ts'
import { emit, log } from '../platform/events.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { seal, unseal } from '../platform/secrets.ts'
import { settings } from '../platform/settings.ts'
import { keysService } from '../cloud/keys-service.ts'
import { recordsService, type Held, type Patch } from '../cloud/records.ts'

const Value = z.object({
  kind: z.union([ConnectionKind, z.literal('provider')]),
  name: z.string(),
  account: z._default(z.string(), ''),
  signIn: z._default(z.boolean(), false),
  createdAt: z.optional(z.string()),
  models: z.optional(z.object({ at: z.string(), models: z.array(ProviderModel) })),
})
const Config = z.record(z.string(), z.unknown())
const Key = z.object({ key: z.string() })
const Seat = z.object({ token: z.string(), at: z.string() })
const Codex = z.object({ accessToken: z.string(), refreshToken: z.string(), at: z.string() })

export type ConnectionValue = z.input<typeof Value>
export type { Secret }

recordsService.onChange((change) => {
  if (change.collection === 'connection' && change.workspace === keysService.account()?.workspace.id) void follow(change)
})

export const connectionRecords = {
  home(): string {
    const home = keysService.account()?.workspace.id
    if (!home || !keysService.vault()) throw new HttpError(409, 'Sign in to OpenHut on this computer first. Connections live in your account.')
    return home
  },

  idFor({ kind, name, account }: { kind: string; name: string; account: string }): string {
    const vault = keysService.vault()
    if (!vault) throw new HttpError(409, 'Sign in to OpenHut on this computer first. Connections live in your account.')
    return `cn_${createHmac('sha256', vault).update(`${kind}|${name}|${account}`).digest('hex').slice(0, 16)}`
  },

  providerId: (id: ProviderId): string => connectionRecords.idFor({ kind: 'provider', name: id, account: '' }),

  async put({ id, value, secret, overwrite = false }: { id: string; value: ConnectionValue; secret: Secret; overwrite?: boolean }): Promise<void> {
    const reapply = overwrite ? () => ({ value, secret }) : undefined
    const saved = await recordsService.put({ collection: 'connection', workspace: connectionRecords.home(), id, value, secret, personal: true, reapply })
    if (saved) await apply(saved)
  },

  async edit({ id, change }: { id: string; change: (current: { value: ConnectionValue; secret: Secret }) => { value: ConnectionValue; secret: Secret } }): Promise<void> {
    const workspace = connectionRecords.home()
    const current = await recordsService.get({ collection: 'connection', workspace, id })
    if (!current || current.deleted) throw new HttpError(404, 'That connection doesn\'t exist. It may have been deleted.')
    const patch = (held: Held): Patch => change(opened(held))
    const saved = await recordsService.put({ collection: 'connection', workspace, id, ...patch(current), personal: true, reapply: (latest) => latest.deleted ? null : patch(latest) })
    if (saved) await apply(saved)
  },

  async remove(id: string): Promise<void> {
    await recordsService.remove({ collection: 'connection', workspace: connectionRecords.home(), id })
    await forget(id)
  },

  async refresh({ id, renew }: { id: string; renew: (secret: Secret) => Promise<Secret> }): Promise<Secret> {
    const held = await recordsService.lease({ collection: 'connection', workspace: connectionRecords.home(), id, refresh: renew })
    await apply(held)
    return opened(held).secret
  },

  async pull(): Promise<void> {
    const rows = await recordsService.list({ collection: 'connection', workspace: connectionRecords.home() })
    for (const row of rows) await apply(row)
    const kept = new Set(rows.map((row) => row.id))
    const local = [...(await db.selectFrom('connection').select('id').execute()).map((row) => row.id), ...PROVIDERS.map((each) => connectionRecords.providerId(each.id))]
    for (const id of local) if (!kept.has(id) && await recordsService.held(id) > 0) await forget(id)
  },
}

export async function uploadConnections(): Promise<void> {
  const owner = await ownerId()
  for (const row of await db.selectFrom('connection').selectAll().execute()) {
    const id = connectionRecords.idFor(row)
    const value = { kind: row.kind, name: row.name, account: row.account, signIn: row.sign_in, createdAt: new Date(row.created_at).toISOString() }
    await upload({ id, value, secret: z.parse(Config, JSON.parse(unseal(row.config))) })
    if (id === row.id) continue
    await db.transaction().execute(async (trx) => {
      await trx.insertInto('connection').values({ id, kind: row.kind, name: row.name, account: row.account, sign_in: row.sign_in, owner_id: owner, config: row.config, created_at: row.created_at })
        .onConflict((oc) => oc.column('id').doNothing()).execute()
      await trx.updateTable('connection_grant').set({ connection_id: id }).where('connection_id', '=', row.id)
        .where(({ not, exists, selectFrom }) => not(exists(selectFrom('connection_grant as g').select('g.id').where('g.connection_id', '=', id).whereRef('g.agent_id', '=', 'connection_grant.agent_id')))).execute()
      await trx.updateTable('connection_event').set({ connection_id: id }).where('connection_id', '=', row.id).execute()
      await trx.deleteFrom('connection').where('id', '=', row.id).execute()
    })
  }
  for (const { id } of PROVIDERS) {
    const secret = providerSecret(id)
    if (secret) await upload({ id: connectionRecords.providerId(id), value: { kind: 'provider', name: id, models: settings.catalog(id) }, secret })
  }
}

async function upload({ id, value, secret }: { id: string; value: ConnectionValue; secret: Secret }): Promise<void> {
  if (await recordsService.get({ collection: 'connection', workspace: connectionRecords.home(), id })) return
  await connectionRecords.put({ id, value, secret }).catch((error: unknown) => {
    if (!(error instanceof HttpError && error.status === 409)) throw error
  })
}

function providerSecret(id: ProviderId): Secret | null {
  if (id === 'claude') return settings.seatToken() ? { token: settings.seatToken(), at: settings.seatAt() ?? new Date().toISOString() } : null
  if (id === 'codex') {
    const tokens = settings.codexTokens()
    return tokens ? { ...tokens, at: settings.codexAt() ?? new Date().toISOString() } : null
  }
  return settings.providerKey(id) ? { key: settings.providerKey(id) } : null
}

async function follow(change: { id: string; ver: number; workspace: string }): Promise<void> {
  try {
    if (await recordsService.held(change.id) >= change.ver) return
    const held = await recordsService.get({ collection: 'connection', workspace: change.workspace, id: change.id })
    if (held?.deleted) await forget(held.id)
    else if (held) await apply(held)
  } catch (error) {
    log.warn({ event: 'connection.follow_failed', connection: change.id, error: messageOf(error) })
  }
}

function opened(held: Held): { value: ConnectionValue; secret: Secret } {
  const { lease: _lease, ...secret } = z.parse(Config, held.secret ?? {})
  return { value: z.parse(Value, held.value), secret }
}

async function apply(held: Held): Promise<void> {
  if (held.deleted) return forget(held.id)
  const { value, secret } = opened(held)
  if (value.kind === 'provider') return applyProvider({ id: z.parse(ProviderId, value.name), secret, models: value.models })
  const fields = { kind: value.kind, name: value.name, account: value.account ?? '', sign_in: value.signIn ?? false, config: seal(JSON.stringify(secret)) }
  await db.insertInto('connection').values({ id: held.id, owner_id: await ownerId(), created_at: value.createdAt ?? new Date(), ...fields })
    .onConflict((oc) => oc.column('id').doUpdateSet(fields)).execute()
  emit({ name: 'connection.synced', target: { type: 'connection', id: held.id } })
}

async function applyProvider({ id, secret, models }: { id: ProviderId; secret: Secret; models: ConnectionValue['models'] }): Promise<void> {
  if (id === 'claude') {
    const seat = z.parse(Seat, secret)
    await settings.setSeatToken(seat.token)
    await settings.setSeatAt(seat.at)
  } else if (id === 'codex') {
    const { at, ...tokens } = z.parse(Codex, secret)
    await settings.setCodexTokens(tokens)
    await settings.setCodexAt(at)
  } else {
    await settings.setProviderKey(id, z.parse(Key, secret).key)
  }
  if (models) await settings.setCatalog(id, models)
  emit({ name: 'provider.synced', target: { type: 'provider', id } })
}

async function forget(id: string): Promise<void> {
  const provider = keysService.vault() ? PROVIDERS.find((each) => connectionRecords.providerId(each.id) === id) : undefined
  if (provider) {
    await settings.forgetProvider(provider.id)
    emit({ name: 'provider.synced', target: { type: 'provider', id: provider.id } })
    return
  }
  await db.deleteFrom('connection').where('id', '=', id).execute()
  emit({ name: 'connection.synced', target: { type: 'connection', id } })
}

async function ownerId(): Promise<string> {
  return (await db.selectFrom('person').select('id').where('role', '=', 'owner').executeTakeFirstOrThrow()).id
}
