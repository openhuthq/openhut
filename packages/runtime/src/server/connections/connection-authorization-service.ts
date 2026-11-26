import { randomBytes } from 'node:crypto'
import type { Selectable } from 'kysely'
import { db } from '../platform/db.ts'
import type { Database } from '../platform/db-schema.ts'
import { seal, unseal } from '../platform/secrets.ts'
import { CONNECTION_TITLES as TITLES, GOOGLE_KINDS, SIGN_IN_KINDS, type ConnectionAuthorization, type CreateConnectionAuthorization } from '@openhut/common/connections/connection.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { github } from '../integrations/github/github.ts'
import { google, type GoogleKind } from '../integrations/google/google.ts'
import { MCP_SERVERS, mcp, type SignIn } from '../integrations/mcp/mcp.ts'
import type { Caller } from '../team/identity.ts'
import { callbackBase, connectionService } from './connection-service.ts'
import type { Secret } from './connection-records.ts'

const SIGN_IN_MS = 15 * 60_000

export const connectionAuthorizationService = {
  async create({ actor, kind: chosen, name, url: given, connectionId }: { actor: Caller } & CreateConnectionAuthorization): Promise<ConnectionAuthorization> {
    const existing = connectionId ? await connectionService.owned({ id: connectionId }) : undefined
    const kind = existing ? signInKind(existing.kind) : chosen
    if (!kind) throw new HttpError(400, 'Pass the kind to sign in to, or the connectionId to reconnect.', { param: 'kind' })
    const url = kind === 'mcp' ? serverUrl({ existing, given }) : knownServer(kind)
    if (kind === 'mcp' && !url) throw new HttpError(400, 'Paste the MCP server URL.', { param: 'url' })
    const state = randomBytes(24).toString('base64url')
    const base = { kind, name: existing?.name ?? name ?? TITLES[kind], actor, connectionId: existing?.id, expires: Date.now() + SIGN_IN_MS }
    if (kind === 'github') {
      const app = github.app()
      if (!app) throw new HttpError(409, github.NOT_SET_UP)
      await remember(state, { ...base, name: existing?.name ?? app.name })
      return started({ state, kind, authorizationUrl: github.installUrl({ app, state }) })
    }
    if (isGoogle(kind)) {
      const { authorizationUrl, verifier } = await google.beginSignIn({ kind, redirectUri: connectionService.redirectUrl(), state })
      await remember(state, { ...base, verifier })
      return started({ state, kind, authorizationUrl })
    }
    const { authorizationUrl, flow } = await mcp.beginSignIn({ url: url ?? '', redirectUrl: connectionService.redirectUrl(), state })
    await remember(state, { ...base, url, flow })
    return started({ state, kind, authorizationUrl })
  },

  async get({ actor, id }: { actor: Caller; id: string }): Promise<ConnectionAuthorization> {
    const row = await db.selectFrom('sign_in').selectAll().where('state', '=', id).where('actor_id', '=', actor.id).executeTakeFirst()
    if (!row) throw new HttpError(404, 'That sign-in isn’t waiting anymore. Start it again.')
    const now = started({ state: id, kind: signInKind(row.kind), authorizationUrl: '' })
    if (row.status === 'done') return { ...now, status: 'done', connectionId: row.connection_id ?? undefined }
    if (row.status === 'failed') return { ...now, status: 'failed', connectionId: row.connection_id ?? undefined, error: row.error ?? undefined }
    if (row.expires_at < new Date()) return { ...now, status: 'failed', error: 'This sign-in expired. Start it again.' }
    return now
  },

  async finish(query: { state?: string; code?: string; error?: string; installation_id?: string; setup_action?: string }): Promise<{ kind?: SignInKind; connectionId?: string; error?: string }> {
    const row = query.state ? await db.updateTable('sign_in').set({ status: 'working' }).where('state', '=', query.state).where('status', '=', 'pending').where('expires_at', '>', new Date()).returningAll().executeTakeFirst() : undefined
    const result = await finishing({ ...query, sign: row && pendingOf(row) })
    if (row) await db.updateTable('sign_in').set({ status: result.error ? 'failed' : 'done', connection_id: result.connectionId ?? null, error: result.error ?? null, data: '' }).where('state', '=', row.state).execute()
    return result
  },

  async sweep(): Promise<void> {
    await db.deleteFrom('sign_in').where('expires_at', '<', new Date(Date.now() - SIGN_IN_MS)).execute()
  },
}

async function finishing({ state, code, error, installation_id: installationId, setup_action: action, sign }: { state?: string; code?: string; error?: string; installation_id?: string; setup_action?: string; sign?: Pending }): Promise<{ kind?: SignInKind; connectionId?: string; error?: string }> {
  if (!sign) return { error: 'This sign-in expired or was already used. Start it again.' }
  if (sign.kind === 'github' && action === 'request') return { kind: sign.kind, error: 'GitHub sent your install request to the account\'s owner. Connect again once they approve it.' }
  const grant = sign.kind === 'github' ? installationId : code
  if (error || !grant) return { kind: sign.kind, error: `${TITLES[sign.kind]} didn't approve OpenHut (${error ?? 'no code'}).` }
  let connectionId = sign.connectionId
  try {
    const { config, account } = await signedIn({ sign, code: grant })
    connectionId = (await connectionService.save({ actor: sign.actor, kind: sign.kind, name: sign.name, config, account, signIn: sign.kind !== 'github', id: sign.connectionId })).id
    await connectionService.listTools({ actor: sign.actor, connectionId })
    return { kind: sign.kind, connectionId }
  } catch (err) {
    return { kind: sign.kind, connectionId, error: messageOf(err) }
  }
}

function started({ state, kind, authorizationUrl }: { state: string; kind: SignInKind; authorizationUrl: string }): ConnectionAuthorization {
  return { object: 'connection_authorization', id: state, kind, authorizationUrl, status: 'pending' }
}

async function signedIn({ sign, code }: { sign: Pending; code: string }): Promise<{ config: Secret; account: string }> {
  if (sign.kind === 'github') return github.installed(Number(code))
  const redirectUri = connectionService.redirectUrl()
  if (isGoogle(sign.kind)) {
    const config = await google.finishSignIn({ code, verifier: sign.verifier ?? '', redirectUri })
    return { config, account: config.email }
  }
  const url = sign.url ?? ''
  const oauth = await mcp.finishSignIn({ url, redirectUrl: redirectUri, flow: sign.flow ?? {}, code })
  return { config: sign.kind === 'mcp' ? { url, oauth } : { oauth }, account: `${new URL(url).host} · signed in by ${sign.actor.email}` }
}

async function remember(state: string, sign: Pending): Promise<void> {
  const { actor, kind, name, connectionId, expires, ...rest } = sign
  const row = { actor: JSON.stringify(actor), actor_id: actor.id, kind, name, existing_id: connectionId ?? null, data: seal(JSON.stringify(rest)), status: 'pending' as const, expires_at: new Date(expires) }
  await db.insertInto('sign_in').values({ state, ...row }).onConflict((conflict) => conflict.column('state').doUpdateSet(row)).execute()
  await connectionAuthorizationService.sweep()
}

function pendingOf(row: Selectable<Database['sign_in']>): Pending {
  const rest = row.data ? JSON.parse(unseal(row.data)) as Omit<Pending, 'actor' | 'kind' | 'name' | 'connectionId' | 'expires'> : {}
  return { ...rest, actor: JSON.parse(row.actor) as Caller, kind: signInKind(row.kind), name: row.name, connectionId: row.existing_id ?? undefined, expires: new Date(row.expires_at).getTime() }
}

function serverUrl({ existing, given }: { existing?: { config: string }; given?: string }): string | undefined {
  if (!existing) return given
  const url: unknown = connectionService.unsealed(existing.config).url
  return typeof url === 'string' ? url : undefined
}

function knownServer(kind: SignInKind): string | undefined {
  if (kind === 'posthog' || kind === 'linear') return MCP_SERVERS[kind]
  return undefined
}

function signInKind(kind: string): SignInKind {
  if (isSignInKind(kind)) return kind
  throw new HttpError(400, 'This connection uses a key, not a sign-in. Delete it and add it again with a new key.')
}

const isSignInKind = (kind: string): kind is SignInKind => SIGN_IN_KINDS.some((each) => each === kind)
const isGoogle = (kind: SignInKind): kind is GoogleKind => (GOOGLE_KINDS as readonly string[]).includes(kind)

type SignInKind = (typeof SIGN_IN_KINDS)[number]
type Pending = { kind: SignInKind; name: string; actor: Caller; connectionId?: string; expires: number; url?: string; flow?: SignIn; verifier?: string }
