import type { FastifyPluginAsync } from 'fastify'
import { CreateThread, SendChat } from '@openhut/common/threads/thread.ts'
import { listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { threadService } from './thread-service.ts'

export const threadController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => listOf({ req, data: await threadService.list({ actor: await who(req) }) }))

  app.post<{ Body: CreateThread }>('/', CreateRequest, async (req) => threadService.create({ actor: await who(req), agentId: req.body.agentId }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => threadService.get({ actor: await who(req), id: req.params.id }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => threadService.delete({ actor: await who(req), id: req.params.id }))

  app.post<{ Params: { id: string }; Body: SendChat }>('/:id/chat', ChatRequest, async (req, reply) => threadService.chat({ actor: await who(req), id: req.params.id, body: req.body, reply }))
}

const CreateRequest = { schema: { body: CreateThread } }
const ChatRequest = { schema: { body: SendChat } }
