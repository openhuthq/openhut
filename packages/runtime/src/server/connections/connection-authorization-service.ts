import { randomBytes } from 'node:crypto'
import { CONNECTION_TITLES as TITLES, GOOGLE_KINDS, SIGN_IN_KINDS, type ConnectionAuthorization, type CreateConnectionAuthorization } from '@openhut/common/connections/connection.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { github, type GithubApp } from '../integrations/github/github.ts'
import { google, type GoogleKind } from '../integrations/google/google.ts'
import { MCP_SERVERS, mcp, type SignIn } from '../integrations/mcp/mcp.ts'
import type { Caller } from '../team/identity.ts'
import { callbackBase, connectionService } from './connection-service.ts'
import type { Secret } from './connection-records.ts'

const SIGN_IN_MS = 15 * 60_000
const pending = new Map<string, Pending>()
const finished = new Map<string, Finished>()

export const connectionAuthorizationService = {
  async create({ actor, kind: chosen, name, url: given, organization, connectionId }: { actor: Caller } & CreateConnectionAuthorization): Promise<ConnectionAuthorization> {
    const existing = connectionId ? await connectionService.owned({ id: connectionId }) : undefined
    const kind = existing ? signInKind(existing.kind) : chosen
    if (!kind) throw new HttpError(400, 'Pass the kind to sign in to, or the connectionId to reconnect.', { param: 'kind' })
    const url = kind === 'mcp' ? serverUrl({ existing, given }) : knownServer(kind)
    if (kind === 'mcp' && !url) throw new HttpError(400, 'Paste the MCP server URL.', { param: 'url' })
    const state = randomBytes(24).toString('base64url')
    const base = { kind, name: existing?.name ?? name ?? TITLES[kind], actor, connectionId: existing?.id, expires: Date.now() + SIGN_IN_MS }
    if (kind === 'github') {
      const { authorizationUrl, manifest } = github.registration({ name: base.name, organization, homeUrl: callbackBase(), redirectUrl: connectionService.redirectUrl(), state })
      remember(state, { ...base, launch: { url: authorizationUrl, manifest } })
      return started({ state, kind, authorizationUrl: `${callbackBase()}/api/connection-authorizations/launch?state=${state}` })
    }
    if (isGoogle(kind)) {
      const { authorizationUrl, verifier } = await google.beginSignIn({ kind, redirectUri: connectionService.redirectUrl(), state })
      remember(state, { ...base, verifier })
      return started({ state, kind, authorizationUrl })
    }
    const { authorizationUrl, flow } = await mcp.beginSignIn({ url: url ?? '', redirectUrl: connectionService.redirectUrl(), state })
    remember(state, { ...base, url, flow })
    return started({ state, kind, authorizationUrl })
  },

  launch(state: string): { url: string; manifest: string } | undefined {
    const sign = pending.get(state)
    return sign && sign.expires >= Date.now() ? sign.launch : undefined
  },

  get({ actor, id }: { actor: Caller; id: string }): ConnectionAuthorization {
    const sign = pending.get(id)
    const done = finished.get(id)
    const owner = sign?.actor ?? done?.actor
    if (!owner || owner.id !== actor.id) throw new HttpError(404, 'That sign-in isn’t waiting anymore. Start it again.')
    const kind = sign?.kind ?? done?.kind ?? 'mcp'
    const now = started({ state: id, kind, authorizationUrl: '' })
    return done ? { ...now, status: done.error ? 'failed' : 'done', connectionId: done.connectionId, error: done.error } : now
  },

  async finish(query: { state?: string; code?: string; error?: string; installation_id?: string }): Promise<{ kind?: SignInKind; connectionId?: string; error?: string; redirect?: string }> {
    const sign = query.state ? pending.get(query.state) : undefined
    const result = await finishing({ ...query, sign })
    if (query.state && sign && !result.redirect) finished.set(query.state, { actor: sign.actor, kind: sign.kind, connectionId: result.connectionId, error: result.error, expires: Date.now() + SIGN_IN_MS })
    return result
  },
}

async function finishing({ state, code, error, installation_id: installationId, sign }: { state?: string; code?: string; error?: string; installation_id?: string; sign?: Pending }): Promise<{ kind?: SignInKind; connectionId?: string; error?: string; redirect?: string }> {
  if (state) pending.delete(state)
  if (!sign || sign.expires < Date.now()) return { error: 'This sign-in expired or was already used. Start it again.' }
  const grant = sign.app ? installationId : code
  if (error || !grant) return { kind: sign.kind, error: `${TITLES[sign.kind]} didn't approve OpenHut (${error ?? 'no code'}).` }
  let connectionId = sign.connectionId
  try {
    if (state && sign.kind === 'github' && !sign.app) {
      const app = await github.register(grant)
      remember(state, { ...sign, name: app.name, app, expires: Date.now() + SIGN_IN_MS })
      return { redirect: github.installUrl({ slug: app.slug, state }) }
    }
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
  if (sign.app) return github.installed({ app: sign.app, installationId: Number(code) })
  const redirectUri = connectionService.redirectUrl()
  if (isGoogle(sign.kind)) {
    const config = await google.finishSignIn({ code, verifier: sign.verifier ?? '', redirectUri })
    return { config, account: config.email }
  }
  const url = sign.url ?? ''
  const oauth = await mcp.finishSignIn({ url, redirectUrl: redirectUri, flow: sign.flow ?? {}, code })
  return { config: sign.kind === 'mcp' ? { url, oauth } : { oauth }, account: `${new URL(url).host} · signed in by ${sign.actor.email}` }
}

function remember(state: string, sign: Pending): void {
  for (const [key, each] of pending) if (each.expires < Date.now()) pending.delete(key)
  for (const [key, each] of finished) if (each.expires < Date.now()) finished.delete(key)
  pending.set(state, sign)
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
type Pending = { kind: SignInKind; name: string; actor: Caller; connectionId?: string; expires: number; url?: string; flow?: SignIn; verifier?: string; app?: GithubApp; launch?: { url: string; manifest: string } }
type Finished = { actor: Caller; kind: SignInKind; connectionId?: string; error?: string; expires: number }
