import type { FastifyPluginAsync } from 'fastify'
import { who } from '../team/identity.ts'
import { invitationService } from './invitation-service.ts'

export const invitationController: FastifyPluginAsync = async (app) => {
  app.post('/', async (req) => invitationService.create({ actor: await who(req) }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    await who(req)
    return invitationService.get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req) => invitationService.decline({ actor: await who(req), id: req.params.id }))
}
