import type { FastifyPluginAsync } from 'fastify'
import { ApproveChangeRequest, DenyChangeRequest, ListChangeRequests } from '@openhut/common/agents/change-request.ts'
import { listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { changeRequestService } from './change-request-service.ts'

export const changeRequestController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListChangeRequests }>('/', ListRequest, async (req) => listOf({ req, data: await changeRequestService.list({ actor: await who(req), agentId: req.query.agentId }) }))

  app.post<{ Params: { id: string }; Body: ApproveChangeRequest }>('/:id/approve', ApproveRequest, async (req) => changeRequestService.approve({ actor: await who(req), id: req.params.id, input: req.body?.input }))

  app.post<{ Params: { id: string }; Body: DenyChangeRequest }>('/:id/deny', DenyRequest, async (req) => changeRequestService.deny({ actor: await who(req), id: req.params.id, note: req.body?.note }))
}

const ListRequest = { schema: { querystring: ListChangeRequests } }
const ApproveRequest = { schema: { body: ApproveChangeRequest } }
const DenyRequest = { schema: { body: DenyChangeRequest } }
