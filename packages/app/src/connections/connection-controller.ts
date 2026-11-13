import type { FastifyPluginAsync } from 'fastify'
import { CreateConnection, CreateConnectionAuthorization, ListConnectionEvents, ListConnectionTools, UpdateConnection } from '@fastmonkey/common/connections/connection.ts'
import { listOf } from '../platform/responses.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { connectionAuthorizationService } from './connection-authorization-service.ts'
import { connectionEventService } from './connection-event-service.ts'
import { connectionService } from './connection-service.ts'

export const connectionController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => listOf({ req, data: await connectionService.list({ actor: await who(req) }) }))

  app.post<{ Body: CreateConnection }>('/', CreateRequest, async (req) => connectionService.create({ actor: await who(req), ...req.body }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => connectionService.get({ actor: await who(req), id: req.params.id }))

  app.patch<{ Params: { id: string }; Body: UpdateConnection }>('/:id', UpdateRequest, async (req) => connectionService.update({ actor: await who(req), id: req.params.id, ...req.body }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => connectionService.delete({ actor: await who(req), id: req.params.id }))
}

export const connectionToolController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListConnectionTools }>('/', ListToolsRequest, async (req) => listOf({ req, data: await connectionService.listTools({ actor: await who(req), connectionId: req.query.connectionId }) }))
}

export const connectionAuthorizationController: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CreateConnectionAuthorization }>('/', AuthorizeRequest, async (req) => connectionAuthorizationService.create({ actor: await who(req), ...req.body }))

  app.get<{ Querystring: { state?: string; code?: string; error?: string; installation_id?: string } }>('/callback', async (req, reply) => {
    const { kind, connectionId, error, redirect } = await connectionAuthorizationService.finish(req.query)
    if (redirect) return reply.redirect(redirect)
    if (!error) return reply.redirect(`/connections/${connectionId}?connected=1`)
    return reply.redirect(`${backTo({ kind, connectionId })}?error=${encodeURIComponent(error)}`)
  })
}

export const connectionEventController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListConnectionEvents }>('/', ListEventsRequest, async (req) => listOf({ req, ...await connectionEventService.list({ actor: await who(req), query: req.query }) }))
}

function backTo({ kind, connectionId }: { kind?: string; connectionId?: string }): string {
  if (connectionId) return `/connections/${connectionId}`
  if (kind) return `/connections/new/${kind}`
  return '/connections'
}

const CreateRequest = { schema: { body: CreateConnection } }
const UpdateRequest = { schema: { body: UpdateConnection } }
const AuthorizeRequest = { onRequest: requireSignIn, schema: { body: CreateConnectionAuthorization } }
const ListToolsRequest = { schema: { querystring: ListConnectionTools } }
const ListEventsRequest = { schema: { querystring: ListConnectionEvents } }
