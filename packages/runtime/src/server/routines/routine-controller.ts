import type { FastifyPluginAsync } from 'fastify'
import { ListRoutines } from '@openhut/common/routines/routine.ts'
import { listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { routineService } from './routine-service.ts'

export const routineController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListRoutines }>('/', ListRequest, async (req) => listOf({ req, data: await routineService.list({ actor: await who(req), agentId: req.query.agentId }) }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => routineService.stop({ actor: await who(req), id: req.params.id }))
}

const ListRequest = { schema: { querystring: ListRoutines } }
