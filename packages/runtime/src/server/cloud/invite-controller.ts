import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { CreateCloudInvite } from '@openhut/common/cloud/cloud.ts'
import { requireSignIn } from '../team/identity.ts'
import { inviteService } from './invite-service.ts'

export const invitationController: FastifyPluginAsyncZod = async (app) => {
  app.post('/cloud', CloudInviteRequest, async (req) => inviteService.inviteToCloud(req.body))
}

const CloudInviteRequest = { onRequest: requireSignIn, schema: { body: CreateCloudInvite } }
