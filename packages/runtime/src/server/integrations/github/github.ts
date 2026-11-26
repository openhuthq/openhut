import { createSign } from 'node:crypto'
import * as z from 'zod/mini'
import { guardedFetch } from '../../platform/network.ts'
import { db } from '../../platform/db.ts'
import { config } from '../../platform/config.ts'
import { HttpError } from '../../platform/http-error.ts'
import { unseal } from '../../platform/secrets.ts'
import type { Connector, ConnectorContext, ToolSpec } from '../connector.ts'
import { MCP_SERVERS, mcp } from '../mcp/mcp.ts'
import { permissions } from '../../permissions/permissions.ts'

const PERMISSIONS = { contents: 'write', pull_requests: 'write', issues: 'write', actions: 'read', checks: 'read', metadata: 'read' }
const TOKEN_FRESH_MS = 50 * 60_000
const App = z.object({ appId: z.number(), slug: z.string(), pem: z.string() })
const Config = z.extend(App, { installationId: z.number(), botId: z.number() })
const GIT: ToolSpec = {
  name: 'git_credentials',
  description: 'Get the shell commands that let git clone, pull and push in your terminal as the bot. Run them once, then use plain https://github.com URLs: git goes through OpenHut, which adds the key.',
  schema: { type: 'object', properties: {} },
}
const tokens = new Map<number, { at: number; token: string }>()
const remote = mcp.connector({ url: MCP_SERVERS.github, redirectUrl: () => '' })

export const github = {
  registration({ name, organization, homeUrl, redirectUrl, state }: { name: string; organization?: string; homeUrl: string; redirectUrl: string; state: string }): { authorizationUrl: string; manifest: string } {
    const owner = organization ? `organizations/${organization}/` : ''
    return {
      authorizationUrl: `https://github.com/${owner}settings/apps/new?state=${state}`,
      manifest: JSON.stringify({ name: name.slice(0, 34), url: homeUrl, redirect_url: redirectUrl, setup_url: redirectUrl, public: false, default_permissions: PERMISSIONS }),
    }
  },

  async register(code: string): Promise<GithubApp & { name: string }> {
    const app = await call({ path: `/app-manifests/${encodeURIComponent(code)}/conversions`, method: 'POST', schema: z.object({ id: z.number(), slug: z.string(), name: z.string(), pem: z.string() }) })
    return { appId: app.id, slug: app.slug, name: app.name, pem: app.pem }
  },

  installUrl: ({ slug, state }: { slug: string; state: string }): string => `https://github.com/apps/${slug}/installations/new?state=${state}`,

  async installed({ app, installationId }: { app: GithubApp; installationId: number }): Promise<{ config: GithubConfig; account: string }> {
    const installation = await call({ path: `/app/installations/${installationId}`, bearer: appJwt(app), schema: z.object({ account: z.object({ login: z.string() }) }) })
    const bot = await call({ path: `/users/${encodeURIComponent(`${app.slug}[bot]`)}`, schema: z.object({ id: z.number() }) })
    return { config: { appId: app.appId, slug: app.slug, pem: app.pem, installationId, botId: bot.id }, account: `${installation.account.login} · ${app.slug}[bot]` }
  },

  connector: {
    tools: async (ctx) => [GIT, ...await remote.tools(await asBot(ctx))],
    call: async (ctx) => {
      if (ctx.tool !== GIT.name) return remote.call({ ...await asBot(ctx), tool: ctx.tool, args: ctx.args })
      return { text: gitSetup(configOf(ctx.config)), isError: false }
    },
  } satisfies Connector,

  async gitToken({ agentId, push = false }: { agentId: string; push?: boolean }): Promise<string> {
    const row = await db.selectFrom('connection as c').innerJoin('connection_grant as g', 'g.connection_id', 'c.id').select(['c.id', 'c.config'])
      .where('g.agent_id', '=', agentId).where('c.kind', '=', 'github').orderBy('c.created_at').executeTakeFirst()
    if (!row) throw new HttpError(403, 'No GitHub connection is granted to this agent. Ask for one with ask_to_connect.')
    const state = await permissions.decide({ agentId, connectionId: row.id, spec: GIT })
    if (state === 'deny') throw new HttpError(403, 'git_credentials is set to Never for you, so git can\'t reach GitHub. Ask your owner to change it in OpenHut.')
    if (push && state !== 'allow') throw new HttpError(403, 'Pushing needs git_credentials set to Always. Call call_tool git_credentials to ask your owner, and ask them to choose Always, then push again.')
    return fresh(configOf(JSON.parse(unseal(row.config))))
  },
}

function configOf(stored: unknown): GithubConfig {
  const parsed = z.safeParse(Config, stored)
  if (!parsed.success) throw new Error('This connection predates the GitHub bot. Delete it and connect GitHub again.')
  return parsed.data
}

async function asBot(ctx: ConnectorContext): Promise<ConnectorContext> {
  return { ...ctx, config: { headers: { Authorization: `Bearer ${await fresh(configOf(ctx.config))}` } } }
}

async function fresh(config: GithubConfig): Promise<string> {
  const cached = tokens.get(config.installationId)
  return cached && Date.now() - cached.at < TOKEN_FRESH_MS ? cached.token : mint(config)
}

async function mint(config: GithubConfig): Promise<string> {
  const { token } = await call({ path: `/app/installations/${config.installationId}/access_tokens`, method: 'POST', bearer: appJwt(config), schema: z.object({ token: z.string() }) })
  tokens.set(config.installationId, { at: Date.now(), token })
  return token
}

function gitSetup(config: GithubConfig): string {
  const bot = `${config.slug}[bot]`
  return [
    'Run these in your terminal:',
    'git config --global --unset-all credential.https://github.com.helper; true',
    'git config --global url."$OPENHUT_GATEWAY/u/github/".insteadOf https://github.com/',
    'git config --global "http.$OPENHUT_GATEWAY/.extraHeader" "Authorization: Agent $OPENHUT_AGENT_TOKEN"',
    `git config --global user.name '${bot}'`,
    `git config --global user.email '${config.botId}+${bot}@users.noreply.github.com'`,
    'Then git clone https://github.com/OWNER/REPO.git, commit and push as usual. It reaches only the repositories the bot is installed on.',
  ].join('\n')
}

function appJwt({ appId, pem }: GithubApp): string {
  const now = Math.floor(Date.now() / 1000)
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: appId })}`
  return `${body}.${createSign('RSA-SHA256').update(body).sign(pem, 'base64url')}`
}

async function call<T>({ path, method = 'GET', bearer, schema }: { path: string; method?: string; bearer?: string; schema: z.ZodMiniType<T> }): Promise<T> {
  const res = await guardedFetch(`${config.githubApi}${path}`, { method, headers: { accept: 'application/vnd.github+json', 'user-agent': 'openhut', ...(bearer && { authorization: `Bearer ${bearer}` }) } })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return z.parse(schema, await res.json())
}

export type GithubApp = z.infer<typeof App>
type GithubConfig = z.infer<typeof Config>
