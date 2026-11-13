import type { FastifyPluginAsync } from 'fastify'
import { CreateInvite, CreatePerson, CreateSession } from '@jakebox/common/team/team.ts'
import { deleted, listOf } from '../platform/responses.ts'
import { publicUrl } from '../platform/settings.ts'
import { clearSessionCookie, sessionToken, setSessionCookie, who } from './identity.ts'
import { teamService } from './team-service.ts'

export const setupController: FastifyPluginAsync = async (app) => {
  app.get('/', async () => teamService.setup())
}

export const peopleController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => {
    await who(req)
    return listOf({ req, data: await teamService.listPeople() })
  })

  app.post<{ Body: CreatePerson }>('/', CreatePersonRequest, async (req, reply) => {
    const person = await teamService.createPerson({ body: req.body, origin: publicUrl(req) })
    setSessionCookie({ reply, token: await teamService.createSession({ personId: person.id }) })
    return teamService.me({ personId: person.id, url: publicUrl(req) })
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    await teamService.deletePerson({ actor: await who(req), id: req.params.id })
    return deleted({ id: req.params.id, object: 'person' })
  })
}

export const sessionController: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CreateSession }>('/', CreateSessionRequest, async (req, reply) => {
    const person = await teamService.signIn(req.body)
    setSessionCookie({ reply, token: await teamService.createSession({ personId: person.id }) })
    return teamService.me({ personId: person.id, url: publicUrl(req) })
  })

  app.delete('/current', async (req, reply) => {
    await teamService.endSession({ token: sessionToken(req) })
    clearSessionCookie(reply)
    return deleted({ id: 'current', object: 'session' })
  })
}

export const meController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => teamService.me({ personId: (await who(req)).id, url: publicUrl(req) }))
}

export const inviteController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => listOf({ req, data: await teamService.listInvites({ actor: await who(req) }) }))

  app.post<{ Body: CreateInvite }>('/', CreateInviteRequest, async (req) => teamService.createInvite({ actor: await who(req), role: req.body.role }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    await teamService.deleteInvite({ actor: await who(req), id: req.params.id })
    return deleted({ id: req.params.id, object: 'invite' })
  })
}

export const inviteLinkController: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { token: string } }>('/:token', async (req) => teamService.inviteLink({ token: req.params.token }))
}

const CreatePersonRequest = { schema: { body: CreatePerson } }
const CreateSessionRequest = { schema: { body: CreateSession } }
const CreateInviteRequest = { schema: { body: CreateInvite } }
