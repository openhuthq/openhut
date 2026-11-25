import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import { ConnectionKind } from '@openhut/common/connections/connection.ts'
import { PROVIDERS, ProviderId, ProviderModel } from '@openhut/common/models/provider.ts'
import { db } from '../platform/db.ts'
import { emit } from '../platform/events.ts'
import { HttpError } from '../platform/http-error.ts'
import { seal, unseal } from '../platform/secrets.ts'
import { settings } from '../platform/settings.ts'

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
export type Secret = Record<string, unknown>

export const connectionRecords = {
  idFor({ kind, name, account }: { kind: string; name: string; account: string }): string {
    return `cn_${createHash('sha256').update(`${kind}|${name}|${account}`).digest('hex').slice(0, 16)}`
  },

  providerId: (id: ProviderId): string => connectionRecords.idFor({ kind: 'provider', name: id, account: '' }),

  async put({ id, value, secret }: { id: string; value: ConnectionValue; secret: Secret; overwrite?: boolean }): Promise<void> {
    await apply({ id, value: z.parse(Value, value), secret })
  },

  async edit({ id, change }: { id: string; change: (current: { value: ConnectionValue; secret: Secret }) => { value: ConnectionValue; secret: Secret } }): Promise<void> {
    const next = change(await current(id))
    await apply({ id, value: z.parse(Value, next.value), secret: next.secret })
  },

  remove: (id: string): Promise<void> => forget(id),

  async refresh({ id, renew }: { id: string; renew: (secret: Secret) => Promise<Secret> }): Promise<Secret> {
    const { value, secret } = await current(id)
    const renewed = await renew(secret)
    await apply({ id, value: z.parse(Value, value), secret: renewed })
    return renewed
  },
}

async function current(id: string): Promise<{ value: ConnectionValue; secret: Secret }> {
  const provider = providerOf(id)
  if (provider) {
    const secret = providerSecret(provider)
    if (!secret) throw new HttpError(404, 'That connection doesn\'t exist. It may have been deleted.')
    return { value: { kind: 'provider', name: provider, models: settings.catalog(provider) }, secret }
  }
  const row = await db.selectFrom('connection').selectAll().where('id', '=', id).executeTakeFirst()
  if (!row) throw new HttpError(404, 'That connection doesn\'t exist. It may have been deleted.')
  return { value: { kind: row.kind, name: row.name, account: row.account, signIn: row.sign_in, createdAt: new Date(row.created_at).toISOString() }, secret: z.parse(Config, JSON.parse(unseal(row.config))) }
}

function providerOf(id: string): ProviderId | undefined {
  return PROVIDERS.find((each) => connectionRecords.providerId(each.id) === id)?.id
}

function providerSecret(id: ProviderId): Secret | null {
  if (id === 'claude') return settings.seatToken() ? { token: settings.seatToken(), at: settings.seatAt() ?? new Date().toISOString() } : null
  if (id === 'codex') {
    const tokens = settings.codexTokens()
    return tokens ? { ...tokens, at: settings.codexAt() ?? new Date().toISOString() } : null
  }
  return settings.providerKey(id) ? { key: settings.providerKey(id) } : null
}

async function apply({ id, value, secret }: { id: string; value: z.infer<typeof Value>; secret: Secret }): Promise<void> {
  if (value.kind === 'provider') return applyProvider({ id: z.parse(ProviderId, value.name), secret, models: value.models })
  const fields = { kind: value.kind, name: value.name, account: value.account, sign_in: value.signIn, config: seal(JSON.stringify(secret)) }
  await db.insertInto('connection').values({ id, owner_id: await ownerId(), created_at: value.createdAt ?? new Date(), ...fields })
    .onConflict((oc) => oc.column('id').doUpdateSet(fields)).execute()
  emit({ name: 'connection.synced', target: { type: 'connection', id } })
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
  const provider = providerOf(id)
  if (provider) {
    await settings.forgetProvider(provider)
    emit({ name: 'provider.synced', target: { type: 'provider', id: provider } })
    return
  }
  await db.deleteFrom('connection').where('id', '=', id).execute()
  emit({ name: 'connection.synced', target: { type: 'connection', id } })
}

async function ownerId(): Promise<string> {
  return (await db.selectFrom('person').select('id').where('role', '=', 'owner').executeTakeFirstOrThrow()).id
}
