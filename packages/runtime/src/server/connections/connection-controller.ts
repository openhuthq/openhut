import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import * as z from 'zod/mini'
import { CONNECTION_TITLES, CreateConnection, CreateConnectionAuthorization, ListConnectionEvents, ListConnectionTools } from '@openhut/common/connections/connection.ts'
import { page } from '../platform/page.ts'
import { IdParams, listOf } from '../platform/responses.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { connectionAuthorizationService } from './connection-authorization-service.ts'
import { connectionEventService } from './connection-event-service.ts'
import { connectionService } from './connection-service.ts'

export const connectionController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', async (req) => listOf({ req, data: await connectionService.list({ actor: await who(req) }) }))

  app.post('/', CreateRequest, async (req) => connectionService.create({ actor: await who(req), ...req.body }))

  app.get('/:id', { schema: { params: IdParams } }, async (req) => connectionService.get({ actor: await who(req), id: req.params.id }))

  app.delete('/:id', { schema: { params: IdParams } }, async (req) => connectionService.delete({ actor: await who(req), id: req.params.id }))
}

export const connectionToolController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListToolsRequest, async (req) => listOf({ req, data: await connectionService.listTools({ actor: await who(req), connectionId: req.query.connectionId }) }))
}

export const connectionAuthorizationController: FastifyPluginAsyncZod = async (app) => {
  app.post('/', AuthorizeRequest, async (req) => connectionAuthorizationService.create({ actor: await who(req), ...req.body }))

  app.get('/callback', { schema: { querystring: CallbackQuery } }, async (req, reply) => {
    if (!req.query.state && req.query.setup_action === 'request') return reply.type('text/html; charset=utf-8').send(page('GitHub asked the owner to approve it. OpenHut connects once they do.', { close: true }))
    if (!req.query.state && req.query.installation_id) return reply.type('text/html; charset=utf-8').send(page('GitHub is installed. You can close this tab.', { close: true }))
    const { kind, error } = await connectionAuthorizationService.finish(req.query)
    const title = kind ? CONNECTION_TITLES[kind] : 'The app'
    return reply.type('text/html; charset=utf-8').send(page(error ? `${error} Go back to OpenHut and try again.` : `${title} is connected. You can close this tab and go back to OpenHut.`))
  })

  app.get('/:id', { schema: { params: IdParams } }, async (req) => connectionAuthorizationService.get({ actor: await who(req), id: req.params.id }))
}

export const connectionEventController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListEventsRequest, async (req) => listOf({ req, ...await connectionEventService.list({ actor: await who(req), query: req.query }) }))
}

const CreateRequest = { schema: { body: CreateConnection } }
const AuthorizeRequest = { onRequest: requireSignIn, schema: { body: CreateConnectionAuthorization } }
const ListToolsRequest = { schema: { querystring: ListConnectionTools } }
const ListEventsRequest = { schema: { querystring: ListConnectionEvents } }
const CallbackQuery = z.object({ state: z.optional(z.string()), code: z.optional(z.string()), error: z.optional(z.string()), installation_id: z.optional(z.string()), setup_action: z.optional(z.string()) })
