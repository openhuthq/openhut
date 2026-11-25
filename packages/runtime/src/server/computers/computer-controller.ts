import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { agentService } from '../agents/agent-service.ts'
import { IdParams, listOf } from '../platform/responses.ts'
import { admin, requireSignIn } from '../team/identity.ts'
import { computerService } from './computer-service.ts'

export const computerController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', SignedIn, async (req) => listOf({ req, data: await computerService.list() }))

  app.post('/', async (req) => computerService.join({ actor: await admin(req) }))

  app.get('/link', { websocket: true }, (socket, req) => computerService.link({ socket, req, onHello: (computer) => agentService.sync({ computer }) }))

  app.get('/:id', { onRequest: requireSignIn, schema: { params: IdParams } }, async (req) => computerService.get({ id: req.params.id }))

  app.delete('/:id', { schema: { params: IdParams } }, async (req) => computerService.remove({ actor: await admin(req), id: req.params.id }))
}

const SignedIn = { onRequest: requireSignIn }
