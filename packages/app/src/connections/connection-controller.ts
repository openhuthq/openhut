import type { FastifyPluginAsync } from 'fastify'
import { CreateConnection, ListConnectionEvents, UpdateConnection } from '@jakebox/common/connections/connection.ts'
import { deleted, listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { connectionEventService } from './connection-event-service.ts'
import { connectionService } from './connection-service.ts'

type Id = { Params: { id: string } }

export const connectionController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => listOf({ req, data: await connectionService.list({ actor: await who(req) }) }))

  app.post<{ Body: CreateConnection }>('/', CreateRequest, async (req) => connectionService.create({ actor: await who(req), ...req.body }))

  app.get<Id>('/:id', async (req) => connectionService.get({ actor: await who(req), id: req.params.id }))

  app.patch<Id & { Body: UpdateConnection }>('/:id', UpdateRequest, async (req) => connectionService.update({ actor: await who(req), id: req.params.id, ...req.body }))

  app.delete<Id>('/:id', async (req) => {
    await connectionService.delete({ actor: await who(req), id: req.params.id })
    return deleted({ id: req.params.id, object: 'connection' })
  })
}

export const connectionEventController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListConnectionEvents }>('/', ListEventsRequest, async (req) => listOf({ req, ...await connectionEventService.list({ actor: await who(req), query: req.query }) }))
}

const CreateRequest = { schema: { body: CreateConnection } }
const UpdateRequest = { schema: { body: UpdateConnection } }
const ListEventsRequest = { schema: { querystring: ListConnectionEvents } }
