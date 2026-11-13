import type { FastifyPluginAsync } from 'fastify'
import { CreateConnection, ListConnectionEvents, UpdateConnection } from '@fastmonkey/common/connections/connection.ts'
import { listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { connectionEventService } from './connection-event-service.ts'
import { connectionService } from './connection-service.ts'

export const connectionController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => listOf({ req, data: await connectionService.list({ actor: await who(req) }) }))

  app.post<{ Body: CreateConnection }>('/', CreateRequest, async (req) => connectionService.create({ actor: await who(req), ...req.body }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => connectionService.get({ actor: await who(req), id: req.params.id }))

  app.patch<{ Params: { id: string }; Body: UpdateConnection }>('/:id', UpdateRequest, async (req) => connectionService.update({ actor: await who(req), id: req.params.id, ...req.body }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => connectionService.delete({ actor: await who(req), id: req.params.id }))
}

export const connectionEventController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListConnectionEvents }>('/', ListEventsRequest, async (req) => listOf({ req, ...await connectionEventService.list({ actor: await who(req), query: req.query }) }))
}

const CreateRequest = { schema: { body: CreateConnection } }
const UpdateRequest = { schema: { body: UpdateConnection } }
const ListEventsRequest = { schema: { querystring: ListConnectionEvents } }
