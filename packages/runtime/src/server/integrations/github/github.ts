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

const PERMISSIONS = { contents: 'write', pull_requests: 'write', issues: 'write', actions: 'write', workflows: 'write', checks: 'read', metadata: 'read' }
const TOOLSETS = 'context,repos,issues,pull_requests,users,actions'
const NO_PERMISSION = /Resource not accessible by integration|without `?\w+`? permission|\b403\b/i
const TOKEN_FRESH_MS = 50 * 60_000
const NOT_SET_UP = 'GitHub isn\'t set up on this server yet. An admin sets it up once in Settings › Admin › GitHub.'
const Config = z.object({ installationId: z.number(), repositories: z.optional(z.array(z.string())) })
const Owner = z.object({ login: z.string(), type: z.enum(['User', 'Organization']), avatar_url: z.string() })
const Installation = z.object({ id: z.number(), account: Owner })
const MAX_REPOS = 300
const Repositories = z.object({ total_count: z.number(), repositories: z.array(z.object({ name: z.string() })) })
const ONCE_MS = 10 * 60_000
const GIT_READ: ToolSpec = {
  name: 'git_read',
  description: 'Get the shell commands that let git clone, pull and push in your terminal as the bot. Run them once, then use plain https://github.com URLs: git goes through OpenHut, which adds the key.',
  schema: { type: 'object', properties: {} },
  annotations: { title: 'Read code', readOnlyHint: true },
}
const GIT_PUSH: ToolSpec = {
  name: 'git_push',
  description: 'Ask to push a branch with git. Call it before you push when pushing waits for your owner, with the repository (owner/name), the branch and the files the push changes (from git diff --numstat against the remote branch, or against the default branch for a new one), so your owner sees what goes out; once approved, push within 10 minutes.',
  schema: {
    type: 'object',
    properties: {
      repo: { type: 'string' },
      branch: { type: 'string' },
      files: { type: 'array', maxItems: 300, items: { type: 'object', properties: { path: { type: 'string' }, added: { type: 'integer' }, removed: { type: 'integer' } }, required: ['path'] } },
    },
    required: ['repo'],
  },
  annotations: { title: 'Push branches', readOnlyHint: false, destructiveHint: false },
  meta: { operation: 'create' },
}
export const GIT_SPECS = [GIT_READ, GIT_PUSH]
export const GIT_TOOLS = GIT_SPECS.map((spec) => spec.name)
const PushArgs = z.object({ repo: z.optional(z.string()), branch: z.optional(z.string()) })
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

  async recheck(stored: unknown): Promise<{ config: GithubConfig; account: string }> {
    try {
      const config = configOf(stored)
      for (const key of tokens.keys()) if (key.startsWith(`${config.installationId}:`)) tokens.delete(key)
      return await github.installed(config.installationId, config.repositories)
    } catch {
      throw new HttpError(409, 'OpenHut can\'t reach this GitHub install anymore. Delete this connection and connect GitHub again.')
    }
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
    tools: async (ctx) => [...GIT_SPECS, ...await remote.tools(await asBot(ctx))],
    call: async (ctx) => {
      if (!GIT_TOOLS.includes(ctx.tool)) {
        const result = await remote.call({ ...await asBot(ctx), tool: ctx.tool, args: ctx.args })
        if (!result.isError || !NO_PERMISSION.test(result.text)) return result
        forget(configOf(ctx.config))
        return remote.call({ ...await asBot(ctx), tool: ctx.tool, args: ctx.args })
      }
      configOf(ctx.config)
      if (ctx.tool === GIT_PUSH.name) return { text: `You can push${pushTarget(ctx.args)} now. If it is only allowed once, push within 10 minutes.`, isError: false }
      return { text: gitSetup(serverApp()), isError: false }
    },
  } satisfies Connector,

  askTitle({ tool, args }: { tool: string; args: Record<string, unknown> }): string | undefined {
    if (tool === GIT_READ.name) return 'Read code on GitHub'
    if (tool !== GIT_PUSH.name) return undefined
    const { repo, branch } = z.safeParse(PushArgs, args).data ?? {}
    return ['Push to GitHub', repo && `${repo}${branch ? ` (${branch})` : ''}`].filter(Boolean).join(' · ')
  },

  async gitToken({ agentId, push = false, repo, refused }: { agentId: string; push?: boolean; repo?: string; refused?: (call: { connectionId: string; app: string; spec: ToolSpec; error: string }) => Promise<void> }): Promise<string> {
    const row = await db.selectFrom('connection as c').innerJoin('connection_grant as g', 'g.connection_id', 'c.id').select(['c.id', 'c.name', 'c.config'])
      .where('g.agent_id', '=', agentId).where('c.kind', '=', 'github').orderBy('c.created_at').executeTakeFirst()
    if (!row) throw new HttpError(403, 'No GitHub connection is granted to this agent. Ask for one with connect_app.')
    const spec = push ? GIT_PUSH : GIT_READ
    const state = await permissions.decide({ agentId, connectionId: row.id, spec })
    const what = push ? `Pushing${repo ? ` to ${repo}` : ''}` : 'Reading code'
    if (state === 'deny') {
      const error = `${what} is set to Never for you on GitHub, so git can't do it. Ask your owner to change it in OpenHut.`
      await refused?.({ connectionId: row.id, app: row.name, spec, error })
      throw new HttpError(403, error)
    }
    if (state === 'ask' && !await approvedOnce({ agentId, connectionId: row.id, tool: spec.name, repo })) {
      throw new HttpError(403, `${what} waits for your owner's OK. Call call_tool github_${spec.name}${push ? ` with repo ${repo ?? 'OWNER/REPO'} and the branch` : ''} to ask, then try again once it is approved.`)
    }
    const config = configOf(JSON.parse(unseal(row.config)))
    if (push) forget(config)
    return fresh(config)
  },


  forgetTokens: (): void => tokens.clear(),
}

function pushTarget(args: Record<string, unknown>): string {
  const { repo, branch } = z.safeParse(PushArgs, args).data ?? {}
  return `${branch ? ` ${branch}` : ''}${repo ? ` to ${repo}` : ''}`
}

async function approvedOnce({ agentId, connectionId, tool, repo }: { agentId: string; connectionId: string; tool: string; repo?: string }): Promise<boolean> {
  const rows = await db.selectFrom('ask').select('input').where('agent_id', '=', agentId).where('kind', '=', 'call_tool').where('status', '=', 'done').where('answered_at', '>', new Date(Date.now() - ONCE_MS)).execute()
  return rows.some((row) => {
    const input = JSON.parse(row.input) as { connectionId?: string; tool?: string; arguments?: Record<string, unknown> }
    const asked = input.arguments?.repo
    return input.connectionId === connectionId && input.tool === tool && (!repo || typeof asked !== 'string' || asked.toLowerCase() === repo.toLowerCase())
  })
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
  return { ...ctx, config: { headers: { Authorization: `Bearer ${await fresh(configOf(ctx.config))}`, 'X-MCP-Toolsets': TOOLSETS } } }
}

function forget(config: GithubConfig): void {
  tokens.delete(tokenKey(config))
}

function tokenKey(config: GithubConfig): string {
  return `${config.installationId}:${config.repositories?.join(',') ?? '*'}`
}

async function fresh(config: GithubConfig): Promise<string> {
  const key = tokenKey(config)
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
