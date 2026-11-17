import type { FastifyPluginAsync } from 'fastify'
import { CreateAgent, CreateGrant, ExportAgent, ImportAgent, ListGrants, MAX_SEALED_AGENT, UpdateAgent } from '@openhut/common/agents/agent.ts'
import { listOf } from '../platform/responses.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { agentService } from './agent-service.ts'

export const agentController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => listOf({ req, data: await agentService.list({ actor: await who(req) }) }))

  app.post<{ Body: CreateAgent }>('/', CreateRequest, async (req) => agentService.create({ actor: await who(req), ...req.body }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => agentService.get({ actor: await who(req), id: req.params.id }))

  app.patch<{ Params: { id: string }; Body: UpdateAgent }>('/:id', UpdateRequest, async (req) => agentService.update({ actor: await who(req), id: req.params.id, patch: req.body }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => agentService.delete({ actor: await who(req), id: req.params.id }))

  app.post<{ Params: { id: string }; Body: ExportAgent }>('/:id/export', ExportRequest, async (req) => agentService.exportSealed({ actor: await who(req), id: req.params.id, publicKey: req.body.publicKey }))

  app.post<{ Body: ImportAgent }>('/imports', ImportRequest, async (req) => agentService.importSealed({ actor: await who(req), sealed: req.body.sealed }))

  app.post<{ Params: { id: string } }>('/:id/revoke-token', async (req) => agentService.revokeToken({ actor: await who(req), id: req.params.id }))
}

export const grantController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListGrants }>('/', ListGrantsRequest, async (req) => listOf({ req, data: await agentService.listGrants(req.query) }))

  app.post<{ Body: CreateGrant }>('/', CreateGrantRequest, async (req) => agentService.createGrant({ actor: await who(req), ...req.body }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => agentService.deleteGrant({ actor: await who(req), id: req.params.id }))
}

const CreateRequest = { schema: { body: CreateAgent } }
const UpdateRequest = { schema: { body: UpdateAgent } }
const ExportRequest = { schema: { body: ExportAgent } }
const ImportRequest = { onRequest: requireSignIn, bodyLimit: MAX_SEALED_AGENT + 1024, schema: { body: ImportAgent } }
const ListGrantsRequest = { onRequest: requireSignIn, schema: { querystring: ListGrants } }
const CreateGrantRequest = { schema: { body: CreateGrant } }
