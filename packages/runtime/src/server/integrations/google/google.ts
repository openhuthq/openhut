import { createHash, randomBytes } from 'node:crypto'
import * as z from 'zod/mini'
import type { GOOGLE_KINDS } from '@openhut/common/connections/connection.ts'
import { cloud } from '../../platform/cloud.ts'
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
const Config = z.object({ accessToken: z.string(), refreshToken: z.string(), expiresAt: z.number(), email: z.string() })
const toolHomes = new Map<string, string>()

export const google = {
  apis: (kind: GoogleKind): string[] => PRODUCTS[kind].servers.map((url) => new URL(url).host),

  async beginSignIn({ kind, redirectUri, state }: { kind: GoogleKind; redirectUri: string; state: string }): Promise<{ authorizationUrl: string; verifier: string }> {
    const verifier = randomBytes(32).toString('base64url')
    const { authorizationUrl } = await cloud.authorization({
      provider: 'google', scopes: PRODUCTS[kind].scopes.map((scope) => `${SCOPE}${scope}`), redirectUrl: redirectUri, state,
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    })
    return { authorizationUrl, verifier }
  },

  async finishSignIn({ code, verifier }: { code: string; verifier: string }): Promise<GoogleConfig> {
    const token = await cloud.token({ provider: 'google', grantType: 'authorization_code', code, codeVerifier: verifier })
    if (!token.refreshToken) throw new Error('Google didn’t send a refresh token. Remove OpenHut from your Google account’s third-party access, then sign in again.')
    return { accessToken: token.accessToken, refreshToken: token.refreshToken, expiresAt: Date.parse(token.expiresAt), email: token.email ?? 'a Google account' }
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
  const token = await cloud.token({ provider: 'google', grantType: 'refresh_token', refreshToken: stored.refreshToken }).catch((error: unknown) => {
    throw new Error(`Google refused to refresh this sign-in (${error instanceof Error ? error.message : String(error)}). Press Reconnect on its page.`)
  })
  return { ...stored, accessToken: token.accessToken, refreshToken: token.refreshToken ?? stored.refreshToken, expiresAt: Date.parse(token.expiresAt) }
}

function unique(tools: ToolSpec[]): ToolSpec[] {
  return [...new Map(tools.map((tool) => [tool.name, tool])).values()]
}

export type GoogleKind = (typeof GOOGLE_KINDS)[number]
export type GoogleConfig = z.infer<typeof Config>
