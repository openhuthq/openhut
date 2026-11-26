import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ListRoutines, UpdateRoutine } from '@openhut/common/routines/routine.ts'
import { CreateWebhook, ListWebhooks, UpdateWebhook } from '@openhut/common/webhooks/webhook.ts'
import { agentService } from '../agents/agent-service.ts'
import { IdParams, listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { BODY_MAX, inboxService } from './inbox-service.ts'

export const routineController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListRoutinesRequest, async (req) => {
    const actor = await who(req)
    await agentService.requireVisible({ actor, id: req.query.agentId })
    return listOf({ req, data: await inboxService.routines({ actor, agentId: req.query.agentId }) })
  })

  app.patch('/:id', UpdateRoutineRequest, async (req) => inboxService.updateRoutine({ actor: await who(req), id: req.params.id, ...req.body }))

  app.delete('/:id', IdRequest, async (req) => inboxService.stopRoutine({ actor: await who(req), id: req.params.id }))
}

export const webhookController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListWebhooksRequest, async (req) => listOf({ req, data: await inboxService.webhooks({ actor: await who(req), agentId: req.query.agentId }) }))

  app.post('/', CreateWebhookRequest, async (req) => inboxService.createSource({ actor: await who(req), ...req.body }))

  app.patch('/:id', UpdateWebhookRequest, async (req) => inboxService.updateWebhook({ actor: await who(req), id: req.params.id, ...req.body }))

  app.post('/:id/rotations', IdRequest, async (req) => inboxService.rotateSecret({ actor: await who(req), id: req.params.id }))

  app.delete('/:id', IdRequest, async (req) => inboxService.remove({ actor: await who(req), id: req.params.id }))
}

export const deliveryTargetController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListWebhooksRequest, async (req) => listOf({ req, data: await inboxService.targets({ actor: await who(req), agentId: req.query.agentId }) }))
}

export const inboxReceiver: FastifyPluginAsyncZod = async (app) => {
  app.removeAllContentTypeParsers()
  app.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: BODY_MAX }, (_req, body, done) => done(null, body))

  app.post('/:id', IdRequest, async (req) => inboxService.receive({ id: req.params.id, headers: req.headers, body: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0) }))
}

const ListRoutinesRequest = { schema: { querystring: ListRoutines } }
const UpdateRoutineRequest = { schema: { params: IdParams, body: UpdateRoutine } }
const ListWebhooksRequest = { schema: { querystring: ListWebhooks } }
const CreateWebhookRequest = { schema: { body: CreateWebhook } }
const UpdateWebhookRequest = { schema: { params: IdParams, body: UpdateWebhook } }
const IdRequest = { schema: { params: IdParams } }
