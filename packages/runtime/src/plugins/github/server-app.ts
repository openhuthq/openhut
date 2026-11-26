import { randomBytes } from 'node:crypto'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import * as z from 'zod/mini'
import { CreateGithubApp, CreateGithubConnection, type GithubAppInfo, type GithubInstallation } from '@openhut/common/connections/github-app.ts'
import type { Connection } from '@openhut/common/connections/connection.ts'
import { connectionService } from '../../server/connections/connection-service.ts'
import { installWaits } from './waits.ts'
import { github } from '../../server/integrations/github/github.ts'
import { publicAddress } from '../../server/platform/address.ts'
import { db } from '../../server/platform/db.ts'
import { emit, log } from '../../server/platform/events.ts'
import { HttpError, messageOf } from '../../server/platform/http-error.ts'
import { page, posting } from '../../server/platform/page.ts'
import { listOf } from '../../server/platform/responses.ts'
import { settings } from '../../server/platform/settings.ts'
import { isAdmin, requireAdmin, who, type Caller } from '../../server/team/identity.ts'

const LAUNCH_MS = 15 * 60_000
const launches = new Map<string, { url: string; manifest: string; expires: number }>()

export const serverAppService = {
  async get({ actor }: { actor: Caller }): Promise<GithubAppInfo> {
    const app = github.app()
    const asks = settings.githubAsks()
    const askedBy = isAdmin(actor) && asks.length ? (await db.selectFrom('person').select(['name', 'email']).where('id', 'in', asks).execute()).map((person) => person.name || person.email) : []
    if (!app) return { object: 'github_app', app: null, asked: asks.includes(actor.id), askedBy }
    const repositories = await github.repositories().catch((err: unknown) => {
      log.warn({ event: 'github.repositories_failed', error: messageOf(err) })
      return null
    })
    return {
      object: 'github_app', asked: false, askedBy: [],
      app: { name: app.name, slug: app.slug, avatarUrl: github.avatarUrl(app), owner: app.owner, ownerType: app.ownerType, ownerAvatar: app.ownerAvatar, settingsUrl: github.settingsUrl(app), installUrl: github.installUrl({ app }), repositories },
    }
  },

  async create({ actor, owner, name }: { actor: Caller } & CreateGithubApp): Promise<{ object: 'github_app_launch'; url: string }> {
    requireAdmin(actor)
    if (github.app()) throw new HttpError(409, 'GitHub is already set up. Remove it first to set it up again.')
    const organization = owner && await github.ownerType(owner) === 'Organization' ? owner : undefined
    const state = randomBytes(24).toString('base64url')
    for (const [key, each] of launches) if (each.expires < Date.now()) launches.delete(key)
    launches.set(state, { ...github.manifest({ organization, name, address: publicAddress(), state }), expires: Date.now() + LAUNCH_MS })
    return { object: 'github_app_launch', url: `${publicAddress()}/api/github-app/launch?state=${state}` }
  },

  launch: (state: string): { url: string; manifest: string } | undefined => {
    const found = launches.get(state)
    return found && found.expires >= Date.now() ? found : undefined
  },

  async created({ state, code }: { state?: string; code?: string }): Promise<string> {
    if (!state || !code || !launches.delete(state)) throw new HttpError(400, 'This setup expired or was already used. Start it again in Settings › Admin › GitHub.')
    if (github.app()) throw new HttpError(409, 'GitHub is already set up.')
    const app = await github.created(code)
    await settings.setGithubApp(app)
    await settings.setGithubAsks([])
    emit({ name: 'github_app.created', target: { type: 'github_app', id: String(app.id), name: app.name } })
    return github.installUrl({ app })
  },

  async remove({ actor }: { actor: Caller }): Promise<GithubAppInfo> {
    requireAdmin(actor)
    await settings.setGithubApp(null)
    github.forgetTokens()
    emit({ name: 'github_app.removed', actor, target: { type: 'github_app', id: 'github_app' } })
    return serverAppService.get({ actor })
  },

  async installations(): Promise<GithubInstallation[]> {
    return (await github.installations()).map((each) => ({ object: 'github_installation', ...each }))
  },

  async connect({ actor, installationId, repositories }: { actor: Caller } & CreateGithubConnection): Promise<Connection> {
    const found = (await github.installations()).find((each) => each.installationId === installationId)
    if (!found) throw new HttpError(404, 'The GitHub App isn\'t installed there any more. Install it again.', { param: 'installationId' })
    const unknown = repositories.find((name) => !found.repositories.includes(name))
    if (unknown) throw new HttpError(400, `The GitHub App can't reach ${found.account.login}/${unknown}. Add it to the install on GitHub first.`, { param: 'repositories' })
    const { config, account } = await github.installed(installationId, [...repositories].sort())
    return connectionService.save({ actor, kind: 'github', name: github.app()?.name ?? 'GitHub', config, account, signIn: false })
  },

  async ask({ actor }: { actor: Caller }): Promise<GithubAppInfo> {
    if (!github.app() && !settings.githubAsks().includes(actor.id)) await settings.setGithubAsks([...settings.githubAsks(), actor.id])
    return serverAppService.get({ actor })
  },
}

export const serverAppController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', async (req) => serverAppService.get({ actor: await who(req) }))

  app.post('/', CreateRequest, async (req) => serverAppService.create({ actor: await who(req), ...req.body }))

  app.delete('/', async (req) => serverAppService.remove({ actor: await who(req) }))

  app.get('/installations', async (req) => {
    await who(req)
    return listOf({ req, data: await serverAppService.installations() })
  })

  app.get('/waits', WaitsRequest, async (req) => {
    await who(req)
    return listOf({ req, data: await installWaits.waiting({ askIds: req.query.askId.split(',').slice(0, 50) }) })
  })

  app.post('/connections', ConnectRequest, async (req) => serverAppService.connect({ actor: await who(req), ...req.body }))

  app.post('/requests', async (req) => serverAppService.ask({ actor: await who(req) }))

  app.get('/launch', StateRequest, async (req, reply) => {
    const launch = serverAppService.launch(req.query.state ?? '')
    return reply.type('text/html; charset=utf-8').send(launch ? posting({ url: launch.url, field: 'manifest', value: launch.manifest }) : page('This setup expired. Go back to OpenHut and start it again.'))
  })

  app.get('/callback', CallbackRequest, async (req, reply) => {
    try {
      return reply.redirect(await serverAppService.created(req.query))
    } catch (err) {
      return reply.type('text/html; charset=utf-8').send(page(`${messageOf(err)} Go back to OpenHut and try again.`, { title: 'GitHub isn\'t set up' }))
    }
  })
}

const CreateRequest = { schema: { body: CreateGithubApp } }
const WaitsRequest = { schema: { querystring: z.object({ askId: z.string().check(z.maxLength(2000)) }) } }
const ConnectRequest = { schema: { body: CreateGithubConnection } }
const StateRequest = { schema: { querystring: z.object({ state: z.optional(z.string()) }) } }
const CallbackRequest = { schema: { querystring: z.object({ state: z.optional(z.string()), code: z.optional(z.string()) }) } }
