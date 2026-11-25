import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { CreateCloudInvite, InviteLink } from '@openhut/common/cloud/cloud.ts'
import { requireSignIn } from '../team/identity.ts'
import { inviteService } from './invite-service.ts'

export const invitationController: FastifyPluginAsyncZod = async (app) => {
  app.post('/cloud', CloudInviteRequest, async (req) => inviteService.inviteToCloud(req.body))

  app.post('/cloud/previews', LinkRequest, async (req) => inviteService.previewCloudInvite(req.body))

  app.post('/cloud/joins', LinkRequest, async (req) => inviteService.joinCloud(req.body))
}

const CloudInviteRequest = { onRequest: requireSignIn, schema: { body: CreateCloudInvite } }
const LinkRequest = { onRequest: requireSignIn, schema: { body: InviteLink } }
