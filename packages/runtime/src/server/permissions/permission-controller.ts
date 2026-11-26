import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ListAgentTools, UpdateAgentTools, type AgentTool } from '@openhut/common/connections/connection.ts'
import { listOf } from '../platform/responses.ts'
import { agentService } from '../agents/agent-service.ts'
import { connectionService } from '../connections/connection-service.ts'
import { who, type Caller } from '../team/identity.ts'
import { permissions } from './permissions.ts'

export const permissionController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListRequest, async (req) => {
    const actor = await who(req)
    await agentService.requireVisible({ actor, id: req.query.agentId })
    return listOf({ req, data: await agentTools({ actor, ...req.query }) })
  })

  app.patch('/', UpdateRequest, async (req) => {
    const actor = await who(req)
    const { agentId, connectionId, tools, permission } = req.body
    await agentService.requireOwner({ actor, id: agentId })
    await permissions.set({ actor, agentId, connectionId: (await connectionService.get({ actor, id: connectionId })).id, tools, state: permission })
    return listOf({ req, data: await agentTools({ actor, agentId, connectionId }) })
  })

  app.delete('/', ListRequest, async (req) => {
    const actor = await who(req)
    await agentService.requireOwner({ actor, id: req.query.agentId })
    await permissions.reset({ actor, ...req.query })
    return listOf({ req, data: await agentTools({ actor, ...req.query }) })
  })
}

async function agentTools({ actor, agentId, connectionId }: { actor: Caller; agentId: string; connectionId: string }): Promise<AgentTool[]> {
  return permissions.list({ agentId, connectionId, tools: await connectionService.specs({ actor, connectionId }) })
}

const ListRequest = { schema: { querystring: ListAgentTools } }
const UpdateRequest = { schema: { body: UpdateAgentTools } }
