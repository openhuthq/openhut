import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import * as z from 'zod/mini'
import { CreateInvite, CreatePasswordReset, CreatePerson, CreateSession, FinishPasswordReset, UpdatePerson, UpdateSecurity } from '@openhut/common/team/team.ts'
import { clientOf, rateLimit, requireUnder } from '../platform/rate-limit.ts'
import { deleted, IdParams, listOf } from '../platform/responses.ts'
import { clearSessionCookie, cookieOf, googleStateCookie, GOOGLE_STATE, requireLocal, requireSignIn, sessionToken, setSessionCookie, who } from './identity.ts'
import { routineService } from '../routines/routine-service.ts'
import { securityService } from './security-service.ts'
import { teamService } from './team-service.ts'

export const meController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', async (req) => {
    const caller = await who(req)
    const zone = req.headers['openhut-time-zone']
    if (typeof zone === 'string' && zone) await routineService.setTimeZone(zone)
    return teamService.me({ caller })
  })
}

export const setupController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', async () => teamService.setup())
}

export const setupCodeController: FastifyPluginAsyncZod = async (app) => {
  app.post('/', Local, async () => teamService.mintSetupCode())
}

export const ownerResetController: FastifyPluginAsyncZod = async (app) => {
  app.post('/', Local, async () => teamService.resetOwner())
}

export const peopleController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', SignedIn, async (req) => listOf({ req, data: await teamService.listPeople() }))

  app.post('/', CreatePersonRequest, async (req, reply) => {
    rateLimit({ keys: [`setup:${clientOf(req)}`, `setup:${req.body.email}`], max: 20 })
    const { person, token } = await teamService.createPerson(req.body)
    setSessionCookie({ reply, token })
    return person
  })

  app.patch('/:id', UpdatePersonRequest, async (req) => teamService.updatePerson({ actor: await who(req), id: req.params.id, role: req.body.role }))

  app.delete('/:id', { schema: { params: IdParams } }, async (req) => teamService.deletePerson({ actor: await who(req), id: req.params.id }))
}

export const sessionController: FastifyPluginAsyncZod = async (app) => {
  app.post('/', CreateSessionRequest, async (req, reply) => {
    const keys = [`login:${clientOf(req)}`, `login:${req.body.email}`]
    requireUnder({ keys, max: 10 })
    const { session, token } = await teamService.createSession(req.body).catch((err: unknown) => { rateLimit({ keys, max: Infinity }); throw err })
    setSessionCookie({ reply, token })
    return session
  })

  app.delete('/current', async (req, reply) => {
    await teamService.endSession({ token: sessionToken(req) })
    clearSessionCookie(reply)
    return deleted({ id: 'current', object: 'session' })
  })
}

export const inviteController: FastifyPluginAsyncZod = async (app) => {
  app.post('/', CreateInviteRequest, async (req) => teamService.createInvite({ actor: await who(req), role: req.body.role }))

  app.get('/:token', { schema: { params: TokenParams } }, async (req) => {
    rateLimit({ keys: [`invite:${clientOf(req)}`], max: 60 })
    return teamService.getInvite(req.params)
  })
}

export const passwordResetController: FastifyPluginAsyncZod = async (app) => {
  app.post('/', CreateResetRequest, async (req) => {
    rateLimit({ keys: [`reset:${clientOf(req)}`, `reset:${req.body.email}`], max: 5 })
    return teamService.createPasswordReset(req.body)
  })

  app.patch('/', FinishResetRequest, async (req, reply) => {
    rateLimit({ keys: [`reset:${clientOf(req)}`], max: 20 })
    const { session, token } = await teamService.finishPasswordReset(req.body)
    setSessionCookie({ reply, token })
    return session
  })
}

export const googleSignInController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', async (req, reply) => {
    rateLimit({ keys: [`google:${clientOf(req)}`], max: 30 })
    const { url, state } = teamService.beginGoogleSignIn()
    reply.header('set-cookie', googleStateCookie({ value: state, maxAge: 600 }))
    return reply.redirect(url)
  })

  app.get('/callback', { schema: { querystring: GoogleCallback } }, async (req, reply) => {
    rateLimit({ keys: [`google:${clientOf(req)}`], max: 30 })
    reply.header('set-cookie', googleStateCookie({ value: '', maxAge: 0 }))
    if (!req.query.code || !req.query.state) return reply.redirect('/login?error=google')
    const browserState = cookieOf({ req, name: GOOGLE_STATE })
    const token = await teamService.finishGoogleSignIn({ state: req.query.state, code: req.query.code, browserState })
      .catch((err: unknown) => { req.log.warn(err); return undefined })
    if (!token) return reply.redirect('/login?error=google')
    setSessionCookie({ reply, token })
    return reply.redirect('/')
  })
}

export const securityController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', SignedIn, async () => securityService.get())

  app.patch('/', UpdateSecurityRequest, async (req) => securityService.update({ actor: await who(req), patch: req.body }))

  app.post('/test-emails', async (req) => securityService.sendTestEmail({ actor: await who(req) }))
}

const Local = { onRequest: requireLocal }
const SignedIn = { onRequest: requireSignIn }
const TokenParams = z.object({ token: z.string().check(z.maxLength(200)) })
const GoogleCallback = z.object({ code: z.optional(z.string()), state: z.optional(z.string()) })
const CreatePersonRequest = { schema: { body: CreatePerson } }
const UpdatePersonRequest = { schema: { params: IdParams, body: UpdatePerson } }
const CreateSessionRequest = { schema: { body: CreateSession } }
const CreateInviteRequest = { schema: { body: CreateInvite } }
const CreateResetRequest = { schema: { body: CreatePasswordReset } }
const FinishResetRequest = { schema: { body: FinishPasswordReset } }
const UpdateSecurityRequest = { schema: { body: UpdateSecurity } }
