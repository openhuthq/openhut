import type { FastifyPluginAsync } from 'fastify'
import { UpdateMemory } from '@openhut/common/agents/memory.ts'
import { who } from '../team/identity.ts'
import { memoryService } from './memory-service.ts'

export const memoryController: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/:id', async (req) => memoryService.get({ actor: await who(req), agentId: req.params.id }))

  app.patch<{ Params: { id: string }; Body: UpdateMemory }>('/:id', UpdateRequest, async (req) => memoryService.update({ actor: await who(req), agentId: req.params.id, patch: req.body }))
}

const UpdateRequest = { schema: { body: UpdateMemory } }
