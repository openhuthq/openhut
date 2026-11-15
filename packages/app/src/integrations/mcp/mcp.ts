import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { OAuthClientInformationFullSchema, OAuthTokensSchema, type OAuthClientInformationFull, type OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import * as z from 'zod/mini'
import { log } from '../../platform/events.ts'
import { HttpError, messageOf } from '../../platform/http-error.ts'
import { guardedFetch } from '../../platform/network.ts'
import type { Connector, ConnectorContext, ToolResult, ToolSpec } from '../connector.ts'

export const MCP_SERVERS = { posthog: 'https://mcp.posthog.com/mcp', linear: 'https://mcp.linear.app/mcp', github: 'https://api.githubcopilot.com/mcp/' }
const MAX_PAGES = 10
const HEADER = /^([A-Za-z0-9][A-Za-z0-9-]{0,63}):\s*(\S.{0,3900})$/
const FORBIDDEN_HEADERS = /^(host|content-length|content-type|transfer-encoding|connection|accept|mcp-session-id|mcp-protocol-version)$/i
const Stored = z.object({
  url: z.optional(z.string()),
  headers: z.optional(z.record(z.string(), z.string())),
  oauth: z.optional(z.object({ clientInformation: z.optional(z.unknown()), tokens: z.optional(z.unknown()) })),
})

export const mcp = {
  connector({ url: fixedUrl, redirectUrl }: { url?: string; redirectUrl: () => string }): Connector {
    const open = ({ config, save }: ConnectorContext) => {
      const stored = z.parse(Stored, config)
      const url = fixedUrl ?? stored.url
      if (!url) throw new Error('This connection has no server URL. Delete it and connect again.')
      return { url, headers: stored.headers, oauth: stored.oauth && signIn(stored.oauth), redirectUrl: redirectUrl(), save: (oauth: SignIn) => save({ ...stored, oauth }) }
    }
    return {
      tools: (ctx) => withClient(open(ctx), listTools),
      call: (ctx) => withClient(open(ctx), (client) => callTool({ client, tool: ctx.tool, args: ctx.args })),
    }
  },

  async probe({ url, headers }: { url: string; headers: Record<string, string> | undefined }): Promise<number> {
    return (await withClient({ url, headers, redirectUrl: '' }, listTools)).length
  },

  async beginSignIn({ url, redirectUrl, state }: { url: string; redirectUrl: string; state: string }): Promise<{ authorizationUrl: string; flow: SignIn }> {
    const flow: SignIn = {}
    const provider = providerFor({ flow, redirectUrl, state })
    const result = await auth(provider, { serverUrl: url, fetchFn: guardedFetch }).catch((err: unknown) => {
      log.warn({ event: 'mcp.sign_in_refused', host: new URL(url).host, error: messageOf(err).slice(0, 300) })
      throw new HttpError(400, `${new URL(url).host} doesn't offer an MCP sign-in. Choose A header if it takes an API key, or None if it's public.`, { param: 'url' })
    })
    if (result !== 'REDIRECT' || !provider.authorizationUrl) throw new HttpError(400, `${new URL(url).host} didn't ask for a sign-in. Connect it without one.`, { param: 'url' })
    return { authorizationUrl: provider.authorizationUrl.toString(), flow }
  },

  async finishSignIn({ url, redirectUrl, flow, code }: { url: string; redirectUrl: string; flow: SignIn; code: string }): Promise<SignIn> {
    const result = await auth(providerFor({ flow, redirectUrl, state: '' }), { serverUrl: url, authorizationCode: code, fetchFn: guardedFetch }).catch((err: unknown) => {
      throw new HttpError(400, `${new URL(url).host} refused the sign-in${messageOf(err) ? `: ${messageOf(err)}` : ''}. Start it again.`)
    })
    if (result !== 'AUTHORIZED' || !flow.tokens) throw new HttpError(400, `${new URL(url).host} didn't finish the sign-in. Try again.`)
    return { clientInformation: flow.clientInformation, tokens: flow.tokens }
  },

  parseHeader(header: string | undefined): Record<string, string> | undefined {
    if (!header?.trim()) return undefined
    const [, name, value] = HEADER.exec(header.trim()) ?? []
    if (!name || !value || FORBIDDEN_HEADERS.test(name)) throw new HttpError(400, 'Write the header as Name: value, like Authorization: Bearer sk_live_…', { param: 'header' })
    return { [name]: value }
  },
}

async function withClient<T>({ url, headers, oauth, redirectUrl, save }: { url: string; headers?: Record<string, string>; oauth?: SignIn; redirectUrl: string; save?: (oauth: SignIn) => Promise<void> }, fn: (client: Client) => Promise<T>): Promise<T> {
  const flow: SignIn = { ...oauth }
  const before = JSON.stringify(flow.tokens)
  const provider = oauth ? providerFor({ flow, redirectUrl, state: '' }) : undefined
  const client = new Client({ name: 'openhut', version: '1.0.0' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { authProvider: provider, fetch: guardedFetch, requestInit: { headers: headers ?? {} } }))
    return await fn(client)
  } catch (err) {
    if (provider?.authorizationUrl) throw new Error(`The sign-in to ${new URL(url).host} expired or was revoked. Its owner can press Reconnect on its page.`)
    throw err
  } finally {
    await client.close().catch(() => undefined)
    if (save && JSON.stringify(flow.tokens) !== before) await save({ clientInformation: flow.clientInformation, tokens: flow.tokens })
  }
}

async function listTools(client: Client): Promise<ToolSpec[]> {
  const tools: ToolSpec[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const listed = await client.listTools(cursor ? { cursor } : undefined)
    tools.push(...listed.tools.map((tool) => ({ name: tool.name, description: tool.description ?? '', schema: tool.inputSchema })))
    cursor = listed.nextCursor
    if (!cursor) break
  }
  return tools
}

async function callTool({ client, tool, args }: { client: Client; tool: string; args: Record<string, unknown> }): Promise<ToolResult> {
  const result = await client.callTool({ name: tool, arguments: args })
  const content = z.safeParse(z.array(z.object({ type: z.string(), text: z.optional(z.string()) })), result.content).data ?? []
  const text = content.map((part) => part.type === 'text' ? part.text ?? '' : `[${part.type}]`).join('\n')
  return { text: text || JSON.stringify(result.structuredContent ?? null), isError: result.isError === true }
}

function signIn(stored: { clientInformation?: unknown; tokens?: unknown }): SignIn {
  return {
    clientInformation: stored.clientInformation === undefined ? undefined : OAuthClientInformationFullSchema.parse(stored.clientInformation),
    tokens: stored.tokens === undefined ? undefined : OAuthTokensSchema.parse(stored.tokens),
  }
}

function providerFor({ flow, redirectUrl, state }: { flow: SignIn; redirectUrl: string; state: string }): OAuthClientProvider & { authorizationUrl?: URL } {
  const provider: OAuthClientProvider & { authorizationUrl?: URL } = {
    redirectUrl,
    clientMetadata: { client_name: 'OpenHut', redirect_uris: [redirectUrl], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' },
    state: () => state,
    clientInformation: () => flow.clientInformation,
    saveClientInformation: (info) => { flow.clientInformation = OAuthClientInformationFullSchema.parse(info) },
    tokens: () => flow.tokens,
    saveTokens: (tokens) => { flow.tokens = tokens },
    redirectToAuthorization: (url) => { provider.authorizationUrl = url },
    saveCodeVerifier: (verifier) => { flow.codeVerifier = verifier },
    codeVerifier: () => {
      if (!flow.codeVerifier) throw new HttpError(400, 'This sign-in lost its code verifier. Start it again.')
      return flow.codeVerifier
    },
    invalidateCredentials: (scope) => {
      if (scope === 'all' || scope === 'tokens') flow.tokens = undefined
      if (scope === 'all' || scope === 'client') flow.clientInformation = undefined
    },
  }
  return provider
}

export type SignIn = { clientInformation?: OAuthClientInformationFull; tokens?: OAuthTokens; codeVerifier?: string }
