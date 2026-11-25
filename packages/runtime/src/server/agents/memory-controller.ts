import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { UpdateMemory } from '@openhut/common/agents/memory.ts'
import { who } from '../team/identity.ts'
import { memoryService } from './memory-service.ts'
import { IdParams } from '../platform/responses.ts'

export const memoryController: FastifyPluginAsyncZod = async (app) => {
  app.get('/:id', { schema: { params: IdParams } }, async (req) => memoryService.get({ actor: await who(req), agentId: req.params.id }))

  app.patch('/:id', UpdateRequest, async (req) => memoryService.update({ actor: await who(req), agentId: req.params.id, patch: req.body }))
}

const UpdateRequest = { schema: { params: IdParams, body: UpdateMemory } }
