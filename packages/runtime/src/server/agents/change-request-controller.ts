import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ApproveChangeRequest, DenyChangeRequest, ListChangeRequests } from '@openhut/common/agents/change-request.ts'
import { IdParams, listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { changeRequestService } from './change-request-service.ts'

export const changeRequestController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListRequest, async (req) => listOf({ req, data: await changeRequestService.list({ actor: await who(req), agentId: req.query.agentId }) }))

  app.post('/:id/approvals', ApproveRequest, async (req) => changeRequestService.approve({ actor: await who(req), id: req.params.id, input: req.body?.input }))

  app.post('/:id/denials', DenyRequest, async (req) => changeRequestService.deny({ actor: await who(req), id: req.params.id, note: req.body?.note }))
}

const ListRequest = { schema: { querystring: ListChangeRequests } }
const ApproveRequest = { schema: { params: IdParams, body: ApproveChangeRequest } }
const DenyRequest = { schema: { params: IdParams, body: DenyChangeRequest } }
