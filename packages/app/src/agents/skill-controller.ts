import type { FastifyPluginAsync } from 'fastify'
import { ListSkills, UpdateSkill } from '@fastmonkey/common/agents/skill.ts'
import { listOf } from '../platform/responses.ts'
import { who } from '../team/identity.ts'
import { skillService } from './skill-service.ts'

export const skillController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListSkills }>('/', ListRequest, async (req) => listOf({ req, data: await skillService.list({ actor: await who(req), agentId: req.query.agentId }) }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => skillService.get({ actor: await who(req), id: req.params.id }))

  app.patch<{ Params: { id: string }; Body: UpdateSkill }>('/:id', UpdateRequest, async (req) => skillService.update({ actor: await who(req), id: req.params.id, patch: req.body }))
}

const ListRequest = { schema: { querystring: ListSkills } }
const UpdateRequest = { schema: { body: UpdateSkill } }
