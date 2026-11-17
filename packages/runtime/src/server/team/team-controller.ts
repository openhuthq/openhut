import type { FastifyPluginAsync } from 'fastify'
import { who } from './identity.ts'
import { teamService } from './team-service.ts'

export const meController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => teamService.me({ personId: (await who(req)).id }))
}
