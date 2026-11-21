import type { FastifyPluginAsync } from 'fastify'
import { UnlockCloud } from '@openhut/common/cloud/cloud.ts'
import { requireSignIn } from '../team/identity.ts'
import { cloudService } from './cloud-service.ts'

export const cloudController: FastifyPluginAsync = async (app) => {
  app.get('/', SignedIn, async () => cloudService.status())

  app.post('/sessions', SignedIn, async () => cloudService.start())

  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/callback', async (req, reply) => reply.type('text/html; charset=utf-8').send(await cloudService.finish(req.query)))

  app.delete('/session', SignedIn, async () => cloudService.signOut())

  app.post('/kits', SignedIn, async () => cloudService.newKit())

  app.delete('/account', SignedIn, async () => cloudService.forget())

  app.post<{ Body: UnlockCloud }>('/unlock', UnlockRequest, async (req) => cloudService.unlock(req.body))
}

const SignedIn = { onRequest: requireSignIn }
const UnlockRequest = { onRequest: requireSignIn, schema: { body: UnlockCloud } }
