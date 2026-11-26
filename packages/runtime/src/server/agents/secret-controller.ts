import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ListAgentSecrets, ReplaceSecretValue } from '@openhut/common/agents/secret.ts'
import { IdParams, listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { secretService } from './secret-service.ts'

export const secretController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListRequest, async (req) => listOf({ req, data: await secretService.list({ actor: await who(req), agentId: req.query.agentId }) }))

  app.post('/:id', ReplaceRequest, async (req) => secretService.replace({ actor: await who(req), id: req.params.id, value: req.body.value }))

  app.delete('/:id', DeleteRequest, async (req) => secretService.delete({ actor: await who(req), id: req.params.id }))
}

const ListRequest = { schema: { querystring: ListAgentSecrets } }
const ReplaceRequest = { schema: { params: IdParams, body: ReplaceSecretValue } }
const DeleteRequest = { schema: { params: IdParams } }
