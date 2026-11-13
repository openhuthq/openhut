import type { FastifyPluginAsync } from 'fastify'
import { CreateAgent, CreateGrant, ListGrants, UpdateAgent } from '@jakebox/common/agents/agent.ts'
import { deleted, listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { agentService } from './agent-service.ts'

export const agentController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => listOf({ req, data: await agentService.list({ actor: await who(req) }) }))

  app.post<{ Body: CreateAgent }>('/', CreateRequest, async (req) => agentService.create({ actor: await who(req), ...req.body }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => agentService.get({ actor: await who(req), id: req.params.id }))

  app.patch<{ Params: { id: string }; Body: UpdateAgent }>('/:id', UpdateRequest, async (req) => agentService.update({ actor: await who(req), id: req.params.id, patch: req.body }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    await agentService.delete({ actor: await who(req), id: req.params.id })
    return deleted({ id: req.params.id, object: 'agent' })
  })
}

export const grantController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListGrants }>('/', ListGrantsRequest, async (req) => {
    await who(req)
    return listOf({ req, data: await agentService.listGrants(req.query) })
  })

  app.post<{ Body: CreateGrant }>('/', CreateGrantRequest, async (req) => agentService.createGrant({ actor: await who(req), ...req.body }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    await agentService.deleteGrant({ actor: await who(req), id: req.params.id })
    return deleted({ id: req.params.id, object: 'grant' })
  })
}

const CreateRequest = { schema: { body: CreateAgent } }
const UpdateRequest = { schema: { body: UpdateAgent } }
const ListGrantsRequest = { schema: { querystring: ListGrants } }
const CreateGrantRequest = { schema: { body: CreateGrant } }
