import type { FastifyPluginAsync } from 'fastify'
import { ConfirmRecoveryKit, CreateCloudAuthorization } from '@openhut/common/cloud/cloud.ts'
import { requireSignIn } from '../team/identity.ts'
import { cloudService } from './cloud-service.ts'

export const cloudController: FastifyPluginAsync = async (app) => {
  app.get('/', SignedIn, async () => cloudService.status())

  app.post<{ Body: CreateCloudAuthorization }>('/sessions', StartRequest, async (req) => cloudService.start(req.body))

  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/callback', async (req, reply) => reply.redirect(await cloudService.finish(req.query)))

  app.delete('/session', SignedIn, async () => cloudService.signOut())

  app.post('/kits', SignedIn, async () => cloudService.newKit())

  app.post<{ Body: ConfirmRecoveryKit }>('/kits/confirm', ConfirmRequest, async (req) => cloudService.confirmKit(req.body))
}

const SignedIn = { onRequest: requireSignIn }
const StartRequest = { onRequest: requireSignIn, schema: { body: CreateCloudAuthorization } }
const ConfirmRequest = { onRequest: requireSignIn, schema: { body: ConfirmRecoveryKit } }
