import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ListRoutines } from '@openhut/common/routines/routine.ts'
import { IdParams, listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { routineService } from './routine-service.ts'

export const routineController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListRequest, async (req) => listOf({ req, data: await routineService.list({ actor: await who(req), agentId: req.query.agentId }) }))

  app.delete('/:id', { schema: { params: IdParams } }, async (req) => routineService.stop({ actor: await who(req), id: req.params.id }))
}

const ListRequest = { schema: { querystring: ListRoutines } }
