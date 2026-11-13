import { createHash } from 'node:crypto'
import * as z from 'zod/mini'
import type { Deleted } from '@jakebox/common/api.ts'
import type { CreateOAuthCode, OAuthClient, OAuthCode, OAuthGrant } from '@jakebox/common/team/oauth.ts'
import { db } from '../platform/db.ts'
import { HttpError, OAuthError } from '../platform/http-error.ts'
import { publicUrl } from '../platform/settings.ts'
import { newToken, sha } from '../platform/secrets.ts'
import { record } from '../platform/events.ts'
import { deleted } from '../platform/responses.ts'

export const ACCESS_TOKEN = /^Bearer (jbo_[\w-]+)$/
const CODE_TTL_MS = 10 * 60_000
const ACCESS_TTL_MS = 60 * 60_000
const RedirectUris = z.array(z.string())

export const oauthService = {
  resourceMetadata: () => ({ resource: `${publicUrl()}/mcp`, authorization_servers: [publicUrl()], bearer_methods_supported: ['header'] }),

  serverMetadata: () => ({
    issuer: publicUrl(),
    authorization_endpoint: `${publicUrl()}/mcp/authorize`,
    token_endpoint: `${publicUrl()}/api/oauth/token`,
    registration_endpoint: `${publicUrl()}/api/oauth/clients`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  }),

  async register({ name, redirectUris }: { name: unknown; redirectUris: unknown }): Promise<RegisteredClient> {
    const uris = Array.isArray(redirectUris) ? redirectUris.map(String) : []
    if (!uris.length || !uris.every(redirectable)) throw new OAuthError('invalid_redirect_uri', 'Register at least one https redirect URI, or http on localhost.')
    const id = newToken('jbc')
    const label = (typeof name === 'string' && name.trim() ? name.trim() : 'MCP client').slice(0, 80)
    await db.insertInto('oauth_client').values({ id, name: label, redirect_uris: JSON.stringify(uris) }).execute()
    return { client_id: id, client_name: label, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }
  },

  async client(id: string): Promise<OAuthClient> {
    const row = await db.selectFrom('oauth_client').select(['id', 'name', 'redirect_uris']).where('id', '=', id).executeTakeFirst()
    if (!row) throw new HttpError(404, 'This app isn\'t registered with JakeBox. Start the connection again from the app.')
    return { id: row.id, object: 'oauth_client', name: row.name, redirectUris: RedirectUris.parse(JSON.parse(row.redirect_uris)) }
  },

  async decide({ person, clientId, redirectUri, codeChallenge, codeChallengeMethod, state, allow }: CreateOAuthCode & { person: { id: string; username: string } }): Promise<OAuthCode> {
    const client = await oauthService.client(clientId)
    if (!client.redirectUris.includes(redirectUri)) throw new HttpError(400, 'That redirect address isn\'t registered for this app. Start the connection again from the app.')
    if (!allow) return { object: 'oauth_code', redirect: withParams(redirectUri, { error: 'access_denied', ...(state && { state }) }) }
    if (codeChallengeMethod !== 'S256' || !/^[\w-]{43,128}$/.test(codeChallenge)) throw new HttpError(400, 'The app has to send a PKCE S256 code challenge. Update the app and connect again.')
    const code = newToken('jba')
    await db.insertInto('oauth_code').values({ code_hash: sha(code), client_id: clientId, person_id: person.id, redirect_uri: redirectUri, challenge: codeChallenge, expires_at: new Date(Date.now() + CODE_TTL_MS) }).execute()
    record({ action: 'oauth.app_connected', actor: person, target: { type: 'oauth_client', id: clientId, name: client.name } })
    return { object: 'oauth_code', redirect: withParams(redirectUri, { code, ...(state && { state }) }) }
  },

  async token(body: Record<string, unknown>): Promise<Tokens> {
    const field = (key: string) => {
      const value = body[key]
      return typeof value === 'string' ? value : ''
    }
    switch (field('grant_type')) {
      case 'authorization_code': return exchangeCode({ code: field('code'), verifier: field('code_verifier'), clientId: field('client_id'), redirectUri: field('redirect_uri') })
      case 'refresh_token': return refresh({ refreshToken: field('refresh_token'), clientId: field('client_id') })
      default: throw new OAuthError('unsupported_grant_type', 'Use authorization_code or refresh_token.')
    }
  },

  async owner(access: string): Promise<string | undefined> {
    const row = await db.updateTable('oauth_grant').set({ used_at: new Date() }).where('access_hash', '=', sha(access)).where('access_expires_at', '>', new Date())
      .returning('person_id').executeTakeFirst()
    return row?.person_id
  },

  async grants(personId: string): Promise<OAuthGrant[]> {
    const rows = await db.selectFrom('oauth_grant').innerJoin('oauth_client', 'oauth_client.id', 'oauth_grant.client_id')
      .select(['oauth_grant.id', 'oauth_client.name', 'oauth_grant.created_at', 'oauth_grant.used_at']).where('oauth_grant.person_id', '=', personId)
      .orderBy('oauth_grant.created_at', 'desc').execute()
    return rows.map((row) => ({ id: row.id, object: 'oauth_grant', client: row.name, createdAt: new Date(row.created_at).toISOString(), usedAt: row.used_at ? new Date(row.used_at).toISOString() : null }))
  },

  async revoke({ person, id }: { person: { id: string; username: string }; id: string }): Promise<Deleted<'oauth_grant'>> {
    const gone = await db.deleteFrom('oauth_grant').where('id', '=', id).where('person_id', '=', person.id).executeTakeFirst()
    if (!Number(gone.numDeletedRows)) throw new HttpError(404, 'That app is already disconnected.')
    record({ action: 'oauth.app_disconnected', actor: person, target: { type: 'oauth_grant', id } })
    return deleted({ id, object: 'oauth_grant' })
  },
}

async function exchangeCode({ code, verifier, clientId, redirectUri }: { code: string; verifier: string; clientId: string; redirectUri: string }): Promise<Tokens> {
  const row = await db.deleteFrom('oauth_code').where('code_hash', '=', sha(code)).returningAll().executeTakeFirst()
  const valid = row && new Date(row.expires_at).getTime() >= Date.now() && row.client_id === clientId && row.redirect_uri === redirectUri
    && createHash('sha256').update(verifier).digest('base64url') === row.challenge
  if (!valid) throw new OAuthError('invalid_grant', 'That code is used, expired, or doesn\'t match this app. Sign in again.')
  const tokens = fresh()
  await db.insertInto('oauth_grant').values({ id: newToken('jbg'), client_id: row.client_id, person_id: row.person_id, ...hashes(tokens) }).execute()
  return tokens
}

async function refresh({ refreshToken, clientId }: { refreshToken: string; clientId: string }): Promise<Tokens> {
  const grant = await db.selectFrom('oauth_grant').select(['id', 'client_id']).where('refresh_hash', '=', sha(refreshToken)).executeTakeFirst()
  if (!grant || (clientId && clientId !== grant.client_id)) throw new OAuthError('invalid_grant', 'That refresh token was already used or revoked. Sign in again.')
  const tokens = fresh()
  await db.updateTable('oauth_grant').set(hashes(tokens)).where('id', '=', grant.id).execute()
  return tokens
}

const fresh = (): Tokens => ({ access_token: newToken('jbo'), token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: newToken('jbr'), scope: 'mcp' })
const hashes = (tokens: Tokens) => ({ access_hash: sha(tokens.access_token), refresh_hash: sha(tokens.refresh_token), access_expires_at: new Date(Date.now() + ACCESS_TTL_MS) })

function redirectable(uri: string): boolean {
  if (!URL.canParse(uri)) return false
  const url = new URL(uri)
  return !url.hash && !['javascript:', 'data:', 'file:'].includes(url.protocol) && (url.protocol !== 'http:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
}

function withParams(uri: string, params: Record<string, string>): string {
  const url = new URL(uri)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

type Tokens = { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }
type RegisteredClient = { client_id: string; client_name: string; redirect_uris: string[]; token_endpoint_auth_method: 'none'; grant_types: string[]; response_types: string[] }
