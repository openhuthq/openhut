import type { FastifyPluginAsync } from 'fastify'
import { CreateAutomation, CreateAutomationRun, ListAutomationRuns, ListAutomations, ListSendTargets, UpdateAutomation, WEBHOOK_BODY_MAX } from '@openhut/common/automations/automation.ts'
import { listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { automationService } from './automation-service.ts'

export const automationController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListAutomations }>('/', ListRequest, async (req) => listOf({ req, data: await automationService.list({ actor: await who(req), agentId: req.query.agentId }) }))

  app.post<{ Body: CreateAutomation }>('/', CreateRequest, async (req) => automationService.create({ actor: await who(req), body: req.body }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => automationService.get({ actor: await who(req), id: req.params.id }))

  app.patch<{ Params: { id: string }; Body: UpdateAutomation }>('/:id', UpdateRequest, async (req) => automationService.update({ actor: await who(req), id: req.params.id, patch: req.body }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => automationService.delete({ actor: await who(req), id: req.params.id }))
}

export const automationRunController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListAutomationRuns }>('/', ListRunsRequest, async (req) => listOf({ req, data: await automationService.runs({ actor: await who(req), automationId: req.query.automationId }) }))

  app.post<{ Body: CreateAutomationRun }>('/', CreateRunRequest, async (req, reply) => reply.status(202).send(await automationService.runNow({ actor: await who(req), automationId: req.body.automationId })))
}

export const sendTargetController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListSendTargets }>('/', ListTargetsRequest, async (req) => listOf({ req, data: await automationService.sendTargets({ actor: await who(req), agentId: req.query.agentId }) }))
}

export const hookController: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: WEBHOOK_BODY_MAX }, (_req, body, done) => done(null, body))

  app.post<{ Params: { id: string } }>('/:id', HookRequest, async (req, reply) => reply.status(202).send(await automationService.trigger({ id: req.params.id, authorization: req.headers.authorization, body: req.body ?? undefined })))
}

const ListRequest = { schema: { querystring: ListAutomations } }
const CreateRequest = { schema: { body: CreateAutomation } }
const UpdateRequest = { schema: { body: UpdateAutomation } }
const ListRunsRequest = { schema: { querystring: ListAutomationRuns } }
const CreateRunRequest = { schema: { body: CreateAutomationRun } }
const ListTargetsRequest = { schema: { querystring: ListSendTargets } }
const HookRequest = { bodyLimit: WEBHOOK_BODY_MAX }
