import { createHash, randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import type { GOOGLE_KINDS } from '@fastmonkey/common/connections/connection.ts'
import { HttpError } from '../../platform/http-error.ts'
import { guardedFetch } from '../../platform/network.ts'
import { settings, type GoogleClient } from '../../platform/settings.ts'
import type { Connector, ToolSpec } from '../connector.ts'
import { mcp } from '../mcp/mcp.ts'

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = 'https://oauth2.googleapis.com/token'
const SCOPE = 'https://www.googleapis.com/auth/'
const server = (product: string) => `https://${product}mcp.googleapis.com/mcp/v1`
const PRODUCTS: Record<GoogleKind, { servers: string[]; scopes: string[] }> = {
  gmail: { servers: [server('gmail')], scopes: ['gmail.modify', 'gmail.compose'] },
  drive: { servers: [server('drive')], scopes: ['drive.readonly', 'drive.file'] },
  google: {
    servers: [server('docs'), server('sheets'), server('slides'), server('calendar')],
    scopes: ['drive.readonly', 'drive.file', 'documents', 'spreadsheets', 'presentations', 'calendar.calendarlist.readonly', 'calendar.events', 'calendar.events.freebusy'],
  },
}
const Config = z.object({ accessToken: z.string(), refreshToken: z.string(), expiresAt: z.number(), email: z.string() })
const Tokens = z.object({ access_token: z.string(), expires_in: z.number(), refresh_token: z.optional(z.string()), id_token: z.optional(z.string()) })
const Failure = z.object({ error: z.string(), error_description: z.optional(z.string()) })
const IdToken = z.object({ email: z.string() })
const toolHomes = new Map<string, string>()

export const google = {
  apis: (kind: GoogleKind): string[] => PRODUCTS[kind].servers.map((url) => new URL(url).host),

  beginSignIn({ kind, redirectUri, state }: { kind: GoogleKind; redirectUri: string; state: string }): { authorizationUrl: string; verifier: string } {
    const client = clientOrThrow()
    const verifier = randomBytes(32).toString('base64url')
    const params = new URLSearchParams({
      client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code', access_type: 'offline', prompt: 'consent', state,
      scope: ['openid', 'email', ...PRODUCTS[kind].scopes.map((scope) => `${SCOPE}${scope}`)].join(' '),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    })
    return { authorizationUrl: `${AUTHORIZE}?${params}`, verifier }
  },

  async finishSignIn({ code, verifier, redirectUri }: { code: string; verifier: string; redirectUri: string }): Promise<GoogleConfig> {
    const tokens = await token({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri })
    if (!tokens.refresh_token) throw new HttpError(400, 'Google didn’t send a refresh token. Remove Fast Monkey from your Google account’s third-party access, then sign in again.')
    const email = tokens.id_token ? z.safeParse(IdToken, JSON.parse(Buffer.from(tokens.id_token.split('.')[1] ?? '', 'base64url').toString('utf8') || '{}')).data?.email : undefined
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, expiresAt: Date.now() + tokens.expires_in * 1000, email: email ?? 'a Google account' }
  },

  account: (config: unknown): string => z.safeParse(Config, config).data?.email ?? 'a Google account',

  connector(kind: GoogleKind): Connector {
    const { servers } = PRODUCTS[kind]
    return {
      tools: async (ctx) => {
        const headers = await bearer(ctx)
        const lists = await Promise.all(servers.map(async (url) => {
          const tools = await mcp.connector({ url, redirectUrl: () => '' }).tools({ config: { headers }, save: async () => undefined })
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
        return mcp.connector({ url, redirectUrl: () => '' }).call({ config: { headers }, save: async () => undefined, tool: ctx.tool, args: ctx.args })
      },
    }
  },
}

async function bearer({ config, save }: { config: unknown; save: (config: unknown) => Promise<void> }): Promise<Record<string, string>> {
  let stored = z.parse(Config, config)
  if (stored.expiresAt - 60_000 < Date.now()) {
    const tokens = await token({ grant_type: 'refresh_token', refresh_token: stored.refreshToken })
    stored = { ...stored, accessToken: tokens.access_token, refreshToken: tokens.refresh_token ?? stored.refreshToken, expiresAt: Date.now() + tokens.expires_in * 1000 }
    await save(stored)
  }
  return { authorization: `Bearer ${stored.accessToken}` }
}

async function token(grant: Record<string, string>): Promise<z.infer<typeof Tokens>> {
  const client = clientOrThrow()
  const response = await guardedFetch(TOKEN, {
    method: 'POST', body: new URLSearchParams({ ...grant, client_id: client.clientId, client_secret: client.clientSecret }), signal: AbortSignal.timeout(15_000),
  })
  const body: unknown = await response.json().catch(() => undefined)
  const tokens = z.safeParse(Tokens, body)
  if (response.ok && tokens.success) return tokens.data
  const failure = z.safeParse(Failure, body).data
  if (failure?.error === 'invalid_grant') throw new Error('Google revoked this sign-in, or it expired. Its owner can press Reconnect on its page.')
  throw new Error(`Google refused the token request (${failure?.error_description ?? failure?.error ?? `HTTP ${response.status}`}). Check the Google OAuth client in Admin.`)
}

function clientOrThrow(): GoogleClient {
  const client = settings.googleClient()
  if (!client) throw new HttpError(400, 'Set up the Google OAuth client first: an owner or admin pastes it in Admin, or in step 1 of this dialog.')
  return client
}

function unique(tools: ToolSpec[]): ToolSpec[] {
  return [...new Map(tools.map((tool) => [tool.name, tool])).values()]
}

export type GoogleKind = (typeof GOOGLE_KINDS)[number]
export type GoogleConfig = z.infer<typeof Config>
