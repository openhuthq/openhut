import type { FastifyPluginAsync } from 'fastify'
import { CreateInvite, CreatePerson, CreateSession } from '@openhut/common/team/team.ts'
import { deleted, listOf } from '../platform/responses.ts'
import { clearSessionCookie, requireSignIn, sessionToken, setSessionCookie, who } from './identity.ts'
import { teamService } from './team-service.ts'

export const setupController: FastifyPluginAsync = async (app) => {
  app.get('/', async () => teamService.setup())
}

export const peopleController: FastifyPluginAsync = async (app) => {
  app.get('/', SignedIn, async (req) => listOf({ req, data: await teamService.listPeople() }))

  app.post<{ Body: CreatePerson }>('/', CreatePersonRequest, async (req, reply) => {
    const { person, token } = await teamService.createPerson({ ...req.body, origin: `${req.protocol}://${req.host}` })
    setSessionCookie({ reply, token })
    return person
  })

  app.delete<{ Params: { id: string } }>('/:id', async (req) => teamService.deletePerson({ actor: await who(req), id: req.params.id }))
}

export const sessionController: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CreateSession }>('/', CreateSessionRequest, async (req, reply) => {
    const { session, token } = await teamService.createSession(req.body)
    setSessionCookie({ reply, token })
    return session
  })

  app.delete('/current', async (req, reply) => {
    await teamService.endSession({ token: sessionToken(req) })
    clearSessionCookie(reply)
    return deleted({ id: 'current', object: 'session' })
  })
}

export const meController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => teamService.me({ personId: (await who(req)).id }))
}

export const inviteController: FastifyPluginAsync = async (app) => {
  app.get('/', async (req) => listOf({ req, data: await teamService.listInvites({ actor: await who(req) }) }))

  app.post<{ Body: CreateInvite }>('/', CreateInviteRequest, async (req) => teamService.createInvite({ actor: await who(req), ...req.body }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => teamService.deleteInvite({ actor: await who(req), id: req.params.id }))
}

export const inviteLinkController: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { token: string } }>('/:token', async (req) => teamService.inviteLink({ token: req.params.token }))
}

const SignedIn = { onRequest: requireSignIn }
const CreatePersonRequest = { schema: { body: CreatePerson } }
const CreateSessionRequest = { schema: { body: CreateSession } }
const CreateInviteRequest = { schema: { body: CreateInvite } }
