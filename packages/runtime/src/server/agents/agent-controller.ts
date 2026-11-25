import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { CreateAgent, CreateGrant, ListGrants, UpdateAgent } from '@openhut/common/agents/agent.ts'
import { IdParams, listOf } from '../platform/responses.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { agentService } from './agent-service.ts'

export const agentController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', async (req) => listOf({ req, data: await agentService.list({ actor: await who(req) }) }))

  app.post('/', CreateRequest, async (req) => agentService.create({ actor: await who(req), ...req.body }))

  app.get('/:id', { schema: { params: IdParams } }, async (req) => agentService.get({ actor: await who(req), id: req.params.id }))

  app.patch('/:id', UpdateRequest, async (req) => agentService.update({ actor: await who(req), id: req.params.id, patch: req.body }))

  app.delete('/:id', { schema: { params: IdParams } }, async (req) => agentService.delete({ actor: await who(req), id: req.params.id }))

  app.delete('/:id/token', { schema: { params: IdParams } }, async (req) => agentService.revokeToken({ actor: await who(req), id: req.params.id }))
}

export const grantController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListGrantsRequest, async (req) => listOf({ req, data: await agentService.listGrants(req.query) }))

  app.post('/', CreateGrantRequest, async (req) => agentService.createGrant({ actor: await who(req), ...req.body }))

  app.delete('/:id', { schema: { params: IdParams } }, async (req) => agentService.deleteGrant({ actor: await who(req), id: req.params.id }))
}

const CreateRequest = { schema: { body: CreateAgent } }
const UpdateRequest = { schema: { params: IdParams, body: UpdateAgent } }
const ListGrantsRequest = { onRequest: requireSignIn, schema: { querystring: ListGrants } }
const CreateGrantRequest = { schema: { body: CreateGrant } }
