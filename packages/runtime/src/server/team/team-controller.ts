import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { who } from './identity.ts'
import { teamService } from './team-service.ts'

export const meController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', async (req) => teamService.me({ caller: await who(req) }))
}
