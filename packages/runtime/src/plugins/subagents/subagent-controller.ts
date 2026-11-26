import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { IdParams, listOf } from '../../server/platform/responses.ts'
import { who } from '../../server/team/identity.ts'
import { subagentService } from './subagent-service.ts'

export const subagentController: FastifyPluginAsyncZod = async (app) => {
  app.get('/:id/subagents', { schema: { params: IdParams } }, async (req) => listOf({ req, data: await subagentService.list({ actor: await who(req), agentId: req.params.id }) }))
}
