import { createSign } from 'node:crypto'
import * as z from 'zod/mini'
import { guardedFetch } from '../../platform/network.ts'
import { db } from '../../platform/db.ts'
import { config } from '../../platform/config.ts'
import { HttpError } from '../../platform/http-error.ts'
import { unseal } from '../../platform/secrets.ts'
import { settings, type GithubApp } from '../../platform/settings.ts'
import type { Connector, ConnectorContext, ToolSpec } from '../connector.ts'
import { MCP_SERVERS, mcp } from '../mcp/mcp.ts'
import { permissions } from '../../permissions/permissions.ts'

const PERMISSIONS = { contents: 'write', pull_requests: 'write', issues: 'write', actions: 'read', checks: 'read', metadata: 'read' }
const TOKEN_FRESH_MS = 50 * 60_000
const NOT_SET_UP = 'GitHub isn\'t set up on this server yet. An admin sets it up once in Settings › Admin › GitHub.'
const Config = z.object({ installationId: z.number(), repositories: z.optional(z.array(z.string())) })
const Owner = z.object({ login: z.string(), type: z.enum(['User', 'Organization']), avatar_url: z.string() })
const Installation = z.object({ id: z.number(), account: Owner })
const MAX_REPOS = 300
const Repositories = z.object({ total_count: z.number(), repositories: z.array(z.object({ name: z.string() })) })
const GIT: ToolSpec = {
  name: 'git_credentials',
  description: 'Get the shell commands that let git clone, pull and push in your terminal as the bot. Run them once, then use plain https://github.com URLs: git goes through OpenHut, which adds the key.',
  schema: { type: 'object', properties: {} },
}
const tokens = new Map<string, { at: number; token: string }>()
const remote = mcp.connector({ url: MCP_SERVERS.github, redirectUrl: () => '' })

export const github = {
  NOT_SET_UP,

  app: (): GithubApp | undefined => settings.githubApp(),

  async ownerType(login: string): Promise<'User' | 'Organization'> {
    const found = await call({ path: `/users/${encodeURIComponent(login)}`, schema: z.object({ type: z.enum(['User', 'Organization']) }) }).catch(() => {
      throw new HttpError(400, `GitHub has no account named ${login}. Check the spelling.`, { param: 'owner' })
    })
    return found.type
  },

  manifest({ organization, name, address, state }: { organization?: string; name: string; address: string; state: string }): { url: string; manifest: string } {
    const path = organization ? `organizations/${encodeURIComponent(organization)}/` : ''
    const manifest = { name, url: 'https://openhut.dev', redirect_url: `${address}/api/github-app/callback`, setup_url: `${address}/api/connection-authorizations/callback`, setup_on_update: true, public: false, default_permissions: PERMISSIONS }
    return { url: `https://github.com/${path}settings/apps/new?state=${state}`, manifest: JSON.stringify(manifest) }
  },

  async created(code: string): Promise<GithubApp> {
    const app = await call({ path: `/app-manifests/${encodeURIComponent(code)}/conversions`, method: 'POST', schema: z.object({ id: z.number(), slug: z.string(), name: z.string(), pem: z.string(), owner: Owner }) })
    const bot = await call({ path: `/users/${encodeURIComponent(`${app.slug}[bot]`)}`, schema: z.object({ id: z.number() }) })
    return { id: app.id, slug: app.slug, name: app.name, owner: app.owner.login, ownerType: app.owner.type, ownerAvatar: app.owner.avatar_url, pem: app.pem, botId: bot.id }
  },

  avatarUrl: (app: GithubApp): string => `https://avatars.githubusercontent.com/in/${app.id}`,

  settingsUrl: (app: GithubApp): string => `https://github.com/${app.ownerType === 'Organization' ? `organizations/${app.owner}/` : ''}settings/apps/${app.slug}`,

  installUrl: ({ app, state }: { app: GithubApp; state?: string }): string => `https://github.com/apps/${app.slug}/installations/new${state ? `?state=${state}` : ''}`,

  async installed(installationId: number, repositories?: string[]): Promise<{ config: GithubConfig; account: string }> {
    const app = serverApp()
    const installation = await call({ path: `/app/installations/${installationId}`, bearer: appJwt(app), schema: Installation })
    const scope = repositories ? ` · ${repositories.length === 1 ? repositories[0] : `${repositories.length} repos`}` : ''
    return { config: { installationId, ...repositories && { repositories } }, account: `${installation.account.login}${scope} · ${app.slug}[bot]` }
  },

  async repositories(): Promise<number> {
    return (await github.installations()).reduce((sum, each) => sum + each.total, 0)
  },

  async installations(): Promise<GithubInstallation[]> {
    const installations = await call({ path: '/app/installations', bearer: appJwt(serverApp()), schema: z.array(Installation) })
    return Promise.all(installations.map(async ({ id, account }) => {
      const token = await fresh({ installationId: id })
      const names: string[] = []
      let total = 0
      for (let page = 1; names.length < MAX_REPOS; page++) {
        const found = await call({ path: `/installation/repositories?per_page=100&page=${page}`, bearer: token, schema: Repositories })
        total = found.total_count
        names.push(...found.repositories.map((repo) => repo.name))
        if (found.repositories.length < 100) break
      }
      return { installationId: id, account: { login: account.login, type: account.type, avatarUrl: account.avatar_url }, repositories: names, total }
    }))
  },

  async installationRequests(): Promise<{ account: string; requester: string }[]> {
    const requests = await call({ path: '/app/installation-requests', bearer: appJwt(serverApp()), schema: z.array(z.object({ account: z.object({ login: z.string() }), requester: z.object({ login: z.string() }) })) })
    return requests.map((each) => ({ account: each.account.login, requester: each.requester.login }))
  },

  connector: {
    tools: async (ctx) => [GIT, ...await remote.tools(await asBot(ctx))],
    call: async (ctx) => {
      if (ctx.tool !== GIT.name) return remote.call({ ...await asBot(ctx), tool: ctx.tool, args: ctx.args })
      configOf(ctx.config)
      return { text: gitSetup(serverApp()), isError: false }
    },
  } satisfies Connector,

  async gitToken({ agentId, push = false }: { agentId: string; push?: boolean }): Promise<string> {
    const row = await db.selectFrom('connection as c').innerJoin('connection_grant as g', 'g.connection_id', 'c.id').select(['c.id', 'c.config'])
      .where('g.agent_id', '=', agentId).where('c.kind', '=', 'github').orderBy('c.created_at').executeTakeFirst()
    if (!row) throw new HttpError(403, 'No GitHub connection is granted to this agent. Ask for one with connect_app.')
    const state = await permissions.decide({ agentId, connectionId: row.id, spec: GIT })
    if (state === 'deny') throw new HttpError(403, 'git_credentials is set to Never for you, so git can\'t reach GitHub. Ask your owner to change it in OpenHut.')
    if (push && state !== 'allow') throw new HttpError(403, 'Pushing needs git_credentials set to Always. Call call_tool git_credentials to ask your owner, and ask them to choose Always, then push again.')
    return fresh(configOf(JSON.parse(unseal(row.config))))
  },

  forgetTokens: (): void => tokens.clear(),
}

function serverApp(): GithubApp {
  const app = settings.githubApp()
  if (!app) throw new HttpError(409, NOT_SET_UP)
  return app
}

function configOf(stored: unknown): GithubConfig {
  const parsed = z.safeParse(Config, stored)
  if (!parsed.success || (typeof stored === 'object' && stored !== null && 'appId' in stored)) throw new Error('This GitHub connection was made before GitHub moved to one app per server. Reconnect it.')
  return parsed.data
}

async function asBot(ctx: ConnectorContext): Promise<ConnectorContext> {
  return { ...ctx, config: { headers: { Authorization: `Bearer ${await fresh(configOf(ctx.config))}` } } }
}

async function fresh(config: GithubConfig): Promise<string> {
  const key = `${config.installationId}:${config.repositories?.join(',') ?? '*'}`
  const cached = tokens.get(key)
  if (cached && Date.now() - cached.at < TOKEN_FRESH_MS) return cached.token
  const body = config.repositories ? JSON.stringify({ repositories: config.repositories }) : undefined
  const { token } = await call({ path: `/app/installations/${config.installationId}/access_tokens`, method: 'POST', bearer: appJwt(serverApp()), body, schema: z.object({ token: z.string() }) })
  tokens.set(key, { at: Date.now(), token })
  return token
}

function gitSetup(app: GithubApp): string {
  const bot = `${app.slug}[bot]`
  return [
    'Run these in your terminal:',
    'git config --global --unset-all credential.https://github.com.helper; true',
    'git config --global url."$OPENHUT_GATEWAY/u/github/".insteadOf https://github.com/',
    'git config --global "http.$OPENHUT_GATEWAY/.extraHeader" "Authorization: Agent $OPENHUT_AGENT_TOKEN"',
    `git config --global user.name '${bot}'`,
    `git config --global user.email '${app.botId}+${bot}@users.noreply.github.com'`,
    'Then git clone https://github.com/OWNER/REPO.git, commit and push as usual. It reaches only the repositories the bot is installed on.',
  ].join('\n')
}

function appJwt({ id, pem }: GithubApp): string {
  const now = Math.floor(Date.now() / 1000)
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${part({ alg: 'RS256', typ: 'JWT' })}.${part({ iat: now - 60, exp: now + 540, iss: id })}`
  return `${body}.${createSign('RSA-SHA256').update(body).sign(pem, 'base64url')}`
}

async function call<T>({ path, method = 'GET', bearer, body, schema }: { path: string; method?: string; bearer?: string; body?: string; schema: z.ZodMiniType<T> }): Promise<T> {
  const res = await guardedFetch(`${config.githubApi}${path}`, { method, body, headers: { accept: 'application/vnd.github+json', 'user-agent': 'openhut', ...(bearer && { authorization: `Bearer ${bearer}` }), ...(body && { 'content-type': 'application/json' }) } })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return z.parse(schema, await res.json())
}

type GithubConfig = z.infer<typeof Config>
export type GithubInstallation = { installationId: number; account: { login: string; type: 'User' | 'Organization'; avatarUrl: string }; repositories: string[]; total: number }
