import type { FastifyPluginAsync } from 'fastify'
import { CONNECTION_TITLES, CreateConnection, CreateConnectionAuthorization, ListConnectionEvents, ListConnectionTools } from '@openhut/common/connections/connection.ts'
import { page, posting } from '../platform/page.ts'
import { listOf } from '../platform/responses.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { connectionAuthorizationService } from './connection-authorization-service.ts'
import { connectionEventService } from './connection-event-service.ts'
import { connectionService } from './connection-service.ts'

export const connectionController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => listOf({ req, data: await connectionService.list({ actor: await who(req) }) }))

  app.post<{ Body: CreateConnection }>('/', CreateRequest, async (req) => connectionService.create({ actor: await who(req), ...req.body }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => connectionService.get({ actor: await who(req), id: req.params.id }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => connectionService.delete({ actor: await who(req), id: req.params.id }))
}

export const connectionToolController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListConnectionTools }>('/', ListToolsRequest, async (req) => listOf({ req, data: await connectionService.listTools({ actor: await who(req), connectionId: req.query.connectionId }) }))
}

export const connectionAuthorizationController: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CreateConnectionAuthorization }>('/', AuthorizeRequest, async (req) => connectionAuthorizationService.create({ actor: await who(req), ...req.body }))

  app.get<{ Querystring: { state?: string } }>('/launch', async (req, reply) => {
    const launch = connectionAuthorizationService.launch(req.query.state ?? '')
    return reply.type('text/html; charset=utf-8').send(launch ? posting({ url: launch.url, field: 'manifest', value: launch.manifest }) : page('This sign-in expired. Go back to OpenHut and start it again.'))
  })

  app.get<{ Querystring: { state?: string; code?: string; error?: string; installation_id?: string } }>('/callback', async (req, reply) => {
    const { kind, error, redirect } = await connectionAuthorizationService.finish(req.query)
    if (redirect) return reply.redirect(redirect)
    const title = kind ? CONNECTION_TITLES[kind] : 'The app'
    return reply.type('text/html; charset=utf-8').send(page(error ? `${error} Go back to OpenHut and try again.` : `${title} is connected. You can close this tab and go back to OpenHut.`))
  })

  app.get<{ Params: { id: string } }>('/:id', async (req) => connectionAuthorizationService.get({ actor: await who(req), id: req.params.id }))
}

export const connectionEventController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListConnectionEvents }>('/', ListEventsRequest, async (req) => listOf({ req, ...await connectionEventService.list({ actor: await who(req), query: req.query }) }))
}



const CreateRequest = { schema: { body: CreateConnection } }
const AuthorizeRequest = { onRequest: requireSignIn, schema: { body: CreateConnectionAuthorization } }
const ListToolsRequest = { schema: { querystring: ListConnectionTools } }
const ListEventsRequest = { schema: { querystring: ListConnectionEvents } }
