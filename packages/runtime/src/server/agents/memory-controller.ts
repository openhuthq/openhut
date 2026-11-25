import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { agentService } from './agent-service.ts'
import { UpdateMemory } from '@openhut/common/agents/memory.ts'
import { who } from '../team/identity.ts'
import { memoryService } from './memory-service.ts'
import { IdParams } from '../platform/responses.ts'

export const memoryController: FastifyPluginAsyncZod = async (app) => {
  app.get('/:id', { schema: { params: IdParams } }, async (req) => {
    const actor = await who(req)
    await agentService.requireVisible({ actor, id: req.params.id })
    return memoryService.get({ actor, agentId: req.params.id })
  })

  app.patch('/:id', UpdateRequest, async (req) => memoryService.update({ actor: await who(req), agentId: req.params.id, patch: req.body }))
}

const UpdateRequest = { schema: { params: IdParams, body: UpdateMemory } }
