import type { FastifyPluginAsync } from 'fastify'
import { CreateCloudInvite, InviteLink } from '@openhut/common/cloud/cloud.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { invitationService } from './invitation-service.ts'

export const invitationController: FastifyPluginAsync = async (app) => {
  app.post('/', async (req) => invitationService.create({ actor: await who(req) }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    await who(req)
    return invitationService.get(req.params.id)
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req) => invitationService.decline({ actor: await who(req), id: req.params.id }))

  app.post<{ Body: CreateCloudInvite }>('/cloud', CloudInviteRequest, async (req) => invitationService.inviteToCloud(req.body))

  app.post<{ Body: InviteLink }>('/cloud/previews', LinkRequest, async (req) => invitationService.previewCloudInvite(req.body))

  app.post<{ Body: InviteLink }>('/cloud/joins', LinkRequest, async (req) => invitationService.joinCloud(req.body))
}

const CloudInviteRequest = { onRequest: requireSignIn, schema: { body: CreateCloudInvite } }
const LinkRequest = { onRequest: requireSignIn, schema: { body: InviteLink } }
