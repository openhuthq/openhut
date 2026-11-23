import { randomBytes } from 'node:crypto'
import { CONNECTION_TITLES as TITLES, GOOGLE_KINDS, SIGN_IN_KINDS, type ConnectionAuthorization, type CreateConnectionAuthorization } from '@openhut/common/connections/connection.ts'
import { HttpError, messageOf } from '../platform/http-error.ts'
import { github, type GithubApp } from '../integrations/github/github.ts'
import { google, type GoogleKind } from '../integrations/google/google.ts'
import { MCP_SERVERS, mcp, type SignIn } from '../integrations/mcp/mcp.ts'
import type { Caller } from '../team/identity.ts'
import { callbackBase, connectionService } from './connection-service.ts'

const SIGN_IN_MS = 15 * 60_000
const pending = new Map<string, Pending>()

export const connectionAuthorizationService = {
  async create({ actor, kind: chosen, name, url: given, organization, connectionId }: { actor: Caller } & CreateConnectionAuthorization): Promise<ConnectionAuthorization> {
    const existing = connectionId ? await connectionService.owned({ actor, id: connectionId }) : undefined
    const kind = existing ? signInKind(existing.kind) : chosen
    if (!kind) throw new HttpError(400, 'Pass the kind to sign in to, or the connectionId to reconnect.', { param: 'kind' })
    const url = kind === 'mcp' ? serverUrl({ existing, given }) : knownServer(kind)
    if (kind === 'mcp' && !url) throw new HttpError(400, 'Paste the MCP server URL.', { param: 'url' })
    const state = randomBytes(24).toString('base64url')
    const base = { kind, name: existing?.name ?? name ?? TITLES[kind], actor, connectionId: existing?.id, expires: Date.now() + SIGN_IN_MS }
    if (kind === 'github') {
      remember(state, base)
      return { object: 'connection_authorization', kind, ...github.registration({ name: base.name, organization, homeUrl: callbackBase(), redirectUrl: connectionService.redirectUrl(), state }) }
    }
    if (isGoogle(kind)) {
      const { authorizationUrl, verifier } = await google.beginSignIn({ kind, redirectUri: connectionService.redirectUrl(), state })
      remember(state, { ...base, verifier })
      return { object: 'connection_authorization', kind, authorizationUrl }
    }
    const { authorizationUrl, flow } = await mcp.beginSignIn({ url: url ?? '', redirectUrl: connectionService.redirectUrl(), state })
    remember(state, { ...base, url, flow })
    return { object: 'connection_authorization', kind, authorizationUrl }
  },

  async finish({ state, code, error, installation_id: installationId }: { state?: string; code?: string; error?: string; installation_id?: string }): Promise<{ kind?: SignInKind; connectionId?: string; error?: string; redirect?: string }> {
    const sign = state ? pending.get(state) : undefined
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
  },
}

async function signedIn({ sign, code }: { sign: Pending; code: string }): Promise<{ config: unknown; account: string }> {
  if (sign.app) return github.installed({ app: sign.app, installationId: Number(code) })
  const redirectUri = connectionService.redirectUrl()
  if (isGoogle(sign.kind)) {
    const config = await google.finishSignIn({ code, verifier: sign.verifier ?? '' })
    return { config, account: config.email }
  }
  const url = sign.url ?? ''
  const oauth = await mcp.finishSignIn({ url, redirectUrl: redirectUri, flow: sign.flow ?? {}, code })
  return { config: sign.kind === 'mcp' ? { url, oauth } : { oauth }, account: `${new URL(url).host} · signed in by ${sign.actor.email}` }
}

function remember(state: string, sign: Pending): void {
  for (const [key, each] of pending) if (each.expires < Date.now()) pending.delete(key)
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
type Pending = { kind: SignInKind; name: string; actor: Caller; connectionId?: string; expires: number; url?: string; flow?: SignIn; verifier?: string; app?: GithubApp }
