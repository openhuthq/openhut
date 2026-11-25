import { createHash, randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import type { GOOGLE_KINDS } from '@openhut/common/connections/connection.ts'
import { settings } from '../../platform/settings.ts'
import { HttpError } from '../../platform/http-error.ts'
import type { Connector, ConnectorContext, ToolSpec } from '../connector.ts'
import { mcp } from '../mcp/mcp.ts'

const SCOPE = 'https://www.googleapis.com/auth/'
const server = (product: string) => `https://${product}mcp.googleapis.com/mcp/v1`
const PRODUCTS: Record<GoogleKind, { servers: string[]; scopes: string[] }> = {
  gmail: { servers: [server('gmail')], scopes: ['gmail.modify', 'gmail.compose'] },
  drive: { servers: [server('drive')], scopes: ['drive.readonly', 'drive.file'] },
  google: {
    servers: [server('docs'), server('sheets'), server('slides'), server('calendar')],
    scopes: ['drive.readonly', 'drive.file', 'documents', 'spreadsheets', 'presentations', 'calendar.calendarlist.readonly', 'calendar.events', 'calendar.events.freebusy'],
  },
  google_chat: {
    servers: [server('chat')],
    scopes: ['chat.spaces.readonly', 'chat.memberships.readonly', 'chat.messages.readonly', 'chat.messages.create', 'chat.users.readstate', 'chat.users.spacesettings'],
  },
  google_contacts: { servers: ['https://people.googleapis.com/mcp/v1'], scopes: ['directory.readonly', 'userinfo.profile', 'contacts.readonly'] },
  google_search: {
    servers: [server('workspace')],
    scopes: ['gmail.readonly', 'drive.readonly', 'calendar.readonly', 'chat.messages.readonly', 'chat.spaces.readonly', 'chat.memberships.readonly'],
  },
}
const Token = z.object({ access_token: z.string(), refresh_token: z.optional(z.string()), expires_in: z.number(), id_token: z.optional(z.string()) })
const IdClaims = z.object({ email: z.string(), email_verified: z.boolean(), aud: z.string() })
const Config = z.object({ accessToken: z.string(), refreshToken: z.string(), expiresAt: z.number(), email: z.string() })
const toolHomes = new Map<string, string>()

export const google = {
  apis: (kind: GoogleKind): string[] => PRODUCTS[kind].servers.map((url) => new URL(url).host),

  async beginSignIn({ kind, redirectUri, state }: { kind: GoogleKind; redirectUri: string; state: string }): Promise<{ authorizationUrl: string; verifier: string }> {
    const verifier = randomBytes(32).toString('base64url')
    const query = new URLSearchParams({
      client_id: client().id, redirect_uri: redirectUri, response_type: 'code', state, access_type: 'offline', prompt: 'consent',
      scope: ['openid', 'email', ...PRODUCTS[kind].scopes.map((scope) => `${SCOPE}${scope}`)].join(' '),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    })
    return { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${query}`, verifier }
  },

  signInUrl({ redirectUri, state, verifier }: { redirectUri: string; state: string; verifier: string }): string {
    const query = new URLSearchParams({
      client_id: client().id, redirect_uri: redirectUri, response_type: 'code', state, scope: 'openid email', prompt: 'select_account',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    })
    return `https://accounts.google.com/o/oauth2/v2/auth?${query}`
  },

  async verifiedEmail({ code, verifier, redirectUri }: { code: string; verifier: string; redirectUri: string }): Promise<string | undefined> {
    const token = await tokenOf({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })
    const payload = token.id_token?.split('.')[1]
    const claims = z.safeParse(IdClaims, payload ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) : undefined).data
    return claims?.email_verified && claims.aud === client().id ? claims.email.toLowerCase() : undefined
  },

  async finishSignIn({ code, verifier, redirectUri }: { code: string; verifier: string; redirectUri: string }): Promise<GoogleConfig> {
    const token = await tokenOf({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })
    if (!token.refresh_token) throw new Error('Google didn’t send a refresh token. Remove OpenHut from your Google account’s third-party access, then sign in again.')
    return { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000, email: emailOf(token.id_token) }
  },

  account: (config: unknown): string => z.safeParse(Config, config).data?.email ?? 'a Google account',

  connector(kind: GoogleKind): Connector {
    const { servers } = PRODUCTS[kind]
    return {
      tools: async (ctx) => {
        const headers = await bearer(ctx)
        const lists = await Promise.all(servers.map(async (url) => {
          const tools = await mcp.connector({ url, redirectUrl: () => '' }).tools({ config: { headers }, refresh: ctx.refresh })
          for (const tool of tools) toolHomes.set(`${kind}:${tool.name}`, url)
          return tools
        }))
        return unique(lists.flat())
      },
      call: async (ctx) => {
        const headers = await bearer(ctx)
        if (servers.length > 1 && !toolHomes.has(`${kind}:${ctx.tool}`)) await google.connector(kind).tools(ctx)
        const url = servers.length === 1 ? servers[0] : toolHomes.get(`${kind}:${ctx.tool}`)
        if (!url) return { text: `No tool named ${ctx.tool}. Call list_tools to see this connection's tools.`, isError: true }
        return mcp.connector({ url, redirectUrl: () => '' }).call({ config: { headers }, refresh: ctx.refresh, tool: ctx.tool, args: ctx.args })
      },
    }
  },
}

async function bearer({ config, refresh }: ConnectorContext): Promise<Record<string, string>> {
  let stored = z.parse(Config, config)
  if (stored.expiresAt - 60_000 < Date.now()) stored = z.parse(Config, await refresh(renew))
  return { authorization: `Bearer ${stored.accessToken}` }
}

async function renew(latest: Record<string, unknown>): Promise<GoogleConfig> {
  const stored = z.parse(Config, latest)
  const token = await tokenOf({ grant_type: 'refresh_token', refresh_token: stored.refreshToken }).catch((error: unknown) => {
    throw new Error(`Google refused to refresh this sign-in (${error instanceof Error ? error.message : String(error)}). Press Reconnect on its page.`)
  })
  return { ...stored, accessToken: token.access_token, refreshToken: token.refresh_token ?? stored.refreshToken, expiresAt: Date.now() + token.expires_in * 1000 }
}

function client(): { id: string; secret: string } {
  const saved = settings.googleClient()
  if (!saved) throw new HttpError(409, 'Google needs your own OAuth client first. An admin adds it under Settings › Admin.')
  return saved
}

async function tokenOf(fields: Record<string, string>): Promise<z.infer<typeof Token>> {
  const { id, secret } = client()
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ ...fields, client_id: id, client_secret: secret }), signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`Google answered ${res.status}`)
  return z.parse(Token, await res.json())
}

function emailOf(idToken: string | undefined): string {
  const payload = idToken?.split('.')[1]
  const email: unknown = payload ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).email : undefined
  return typeof email === 'string' ? email : 'a Google account'
}

function unique(tools: ToolSpec[]): ToolSpec[] {
  return [...new Map(tools.map((tool) => [tool.name, tool])).values()]
}

export type GoogleKind = (typeof GOOGLE_KINDS)[number]
export type GoogleConfig = z.infer<typeof Config>
