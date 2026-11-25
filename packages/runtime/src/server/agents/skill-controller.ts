import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ListSkills, UpdateSkill } from '@openhut/common/agents/skill.ts'
import { IdParams, listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { skillService } from './skill-service.ts'

export const skillController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListRequest, async (req) => listOf({ req, data: await skillService.list({ actor: await who(req), agentId: req.query.agentId }) }))

  app.get('/:id', { schema: { params: IdParams } }, async (req) => skillService.get({ actor: await who(req), id: req.params.id }))

  app.patch('/:id', UpdateRequest, async (req) => skillService.update({ actor: await who(req), id: req.params.id, patch: req.body }))

  app.delete('/:id', { schema: { params: IdParams } }, async (req) => skillService.delete({ actor: await who(req), id: req.params.id }))
}

const ListRequest = { schema: { querystring: ListSkills } }
const UpdateRequest = { schema: { params: IdParams, body: UpdateSkill } }
