import { createHash } from 'node:crypto'
import { db } from '../platform/db.ts'
import { HttpError } from '../platform/http-error.ts'
import { publicUrl } from '../platform/settings.ts'
import { newToken, sha } from '../platform/secrets.ts'
import type { OAuthClient, OAuthGrant } from '@jakebox/common/team/oauth.ts'

const CODE_TTL_MS = 10 * 60_000
const ACCESS_TTL_MS = 60 * 60_000

export const oauthService = {
  resourceMetadata: () => ({ resource: resourceUrl(), authorization_servers: [publicUrl()], bearer_methods_supported: ['header'] }),

  serverMetadata: () => ({
    issuer: publicUrl(),
    authorization_endpoint: `${publicUrl()}/mcp/authorize`,
    token_endpoint: `${publicUrl()}/api/oauth/token`,
    registration_endpoint: `${publicUrl()}/api/oauth/clients`,
    revocation_endpoint: `${publicUrl()}/api/oauth/revocations`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  }),

  async register({ name, redirectUris }: { name: unknown; redirectUris: unknown }): Promise<RegisteredClient> {
    const uris = Array.isArray(redirectUris) ? redirectUris.map(String) : []
    if (!uris.length || !uris.every(redirectable)) throw new HttpError(400, 'invalid_redirect_uri')
    const id = newToken('jbc')
    const label = (typeof name === 'string' && name.trim() ? name.trim() : 'MCP client').slice(0, 80)
    await db.insertInto('oauth_client').values({ id, name: label, redirect_uris: JSON.stringify(uris) }).execute()
    return { client_id: id, client_name: label, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }
  },

  async client(id: string): Promise<OAuthClient> {
    const row = await db.selectFrom('oauth_client').select(['id', 'name', 'redirect_uris']).where('id', '=', id).executeTakeFirst()
    if (!row) throw new HttpError(404, 'This app is not registered. Start the connection again from the app.')
    return { id: row.id, object: 'oauth_client', name: row.name, redirectUris: JSON.parse(row.redirect_uris) }
  },

  async approve({ userId, clientId, redirectUri, challenge, method, state }: { userId: string; clientId: string; redirectUri: string; challenge: string; method: string; state?: string }): Promise<{ redirect: string }> {
    const client = await this.client(clientId)
    if (!client.redirectUris.includes(redirectUri)) throw new HttpError(400, 'That redirect address is not registered for this app.')
    if (method !== 'S256' || !/^[\w-]{43,128}$/.test(challenge)) throw new HttpError(400, 'The app must send a PKCE S256 code challenge.')
    const code = newToken('jba')
    await db.insertInto('oauth_code').values({ code_hash: sha(code), client_id: clientId, person_id: userId, redirect_uri: redirectUri, challenge, expires_at: new Date(Date.now() + CODE_TTL_MS) }).execute()
    return { redirect: withParams(redirectUri, { code, ...(state && { state }) }) }
  },

  denied({ redirectUri, state }: { redirectUri: string; state?: string }) {
    return withParams(redirectUri, { error: 'access_denied', ...(state && { state }) })
  },

  async token(body: Record<string, unknown>): Promise<Tokens> {
    const field = (k: string) => typeof body[k] === 'string' ? body[k] : ''
    if (field('grant_type') === 'authorization_code') {
      const row = await db.deleteFrom('oauth_code').where('code_hash', '=', sha(field('code'))).returningAll().executeTakeFirst()
      const verifier = field('code_verifier')
      if (!row || new Date(row.expires_at).getTime() < Date.now() || row.client_id !== field('client_id') || row.redirect_uri !== field('redirect_uri')) throw new HttpError(400, 'invalid_grant')
      if (createHash('sha256').update(verifier).digest('base64url') !== row.challenge) throw new HttpError(400, 'invalid_grant')
      return issue({ clientId: row.client_id, userId: row.person_id })
    }
    if (field('grant_type') === 'refresh_token') {
      const grant = await db.selectFrom('oauth_grant').select(['id', 'client_id']).where('refresh_hash', '=', sha(field('refresh_token'))).executeTakeFirst()
      if (!grant || (field('client_id') && field('client_id') !== grant.client_id)) throw new HttpError(400, 'invalid_grant')
      return rotate(grant.id)
    }
    throw new HttpError(400, 'unsupported_grant_type')
  },

  async owner(access: string): Promise<string | undefined> {
    const row = await db.updateTable('oauth_grant').set({ used_at: new Date() }).where('access_hash', '=', sha(access)).where('access_expires_at', '>', new Date()).returning('person_id').executeTakeFirst()
    return row?.person_id
  },

  async grants(userId: string): Promise<OAuthGrant[]> {
    const rows = await db.selectFrom('oauth_grant').innerJoin('oauth_client', 'oauth_client.id', 'oauth_grant.client_id')
      .select(['oauth_grant.id', 'oauth_client.name', 'oauth_grant.created_at', 'oauth_grant.used_at']).where('oauth_grant.person_id', '=', userId).orderBy('oauth_grant.created_at', 'desc').execute()
    return rows.map((r) => ({ id: r.id, object: 'oauth_grant', client: r.name, createdAt: new Date(r.created_at).toISOString(), usedAt: r.used_at ? new Date(r.used_at).toISOString() : null }))
  },

  async revoke({ userId, id }: { userId: string; id: string }): Promise<void> {
    const gone = await db.deleteFrom('oauth_grant').where('id', '=', id).where('person_id', '=', userId).executeTakeFirst()
    if (!Number(gone.numDeletedRows)) throw new HttpError(404, 'That app is already disconnected.')
  },

  async revokeToken(value: string): Promise<void> {
    await db.deleteFrom('oauth_grant').where((eb) => eb.or([eb('access_hash', '=', sha(value)), eb('refresh_hash', '=', sha(value))])).execute()
  },
}

export const ACCESS_TOKEN = /^Bearer (jbo_[\w-]+)$/
const resourceUrl = () => `${publicUrl()}/mcp`

async function issue({ clientId, userId }: { clientId: string; userId: string }): Promise<Tokens> {
  const tokens = fresh()
  await db.insertInto('oauth_grant').values({ id: newToken('jbg'), client_id: clientId, person_id: userId, ...hashes(tokens) }).execute()
  return tokens
}

async function rotate(id: string): Promise<Tokens> {
  const tokens = fresh()
  await db.updateTable('oauth_grant').set(hashes(tokens)).where('id', '=', id).execute()
  return tokens
}

const fresh = (): Tokens => ({ access_token: newToken('jbo'), token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: newToken('jbr'), scope: 'mcp' })
const hashes = (t: Tokens) => ({ access_hash: sha(t.access_token), refresh_hash: sha(t.refresh_token), access_expires_at: new Date(Date.now() + ACCESS_TTL_MS) })

function redirectable(uri: string) {
  try {
    const url = new URL(uri)
    return !url.hash && !['javascript:', 'data:', 'file:'].includes(url.protocol) && (url.protocol !== 'http:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  } catch { return false }
}

function withParams(uri: string, params: Record<string, string>) {
  const url = new URL(uri)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return url.toString()
}


export type Tokens = { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string }
export type RegisteredClient = { client_id: string; client_name: string; redirect_uris: string[]; token_endpoint_auth_method: 'none'; grant_types: string[]; response_types: string[] }
