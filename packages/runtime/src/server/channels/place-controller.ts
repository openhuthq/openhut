import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { agentService } from '../agents/agent-service.ts'
import { IdParams, listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { channelService } from './channel-service.ts'

export const placeController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListRequest, async (req) => {
    await agentService.get({ actor: await who(req), id: req.params.id })
    return listOf({ req, data: await channelService.places({ agentId: req.params.id }) })
  })
}

const ListRequest = { schema: { params: IdParams } }
