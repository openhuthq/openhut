import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import * as z from 'zod/mini'
import { ChangeRole, DeviceKey, PasteSignInCode, RemoveDeviceQuery, SetHere, StartCloudSignIn, UpdateWorkspace } from '@openhut/common/cloud/cloud.ts'
import { requireSignIn } from '../team/identity.ts'
import { cloudService } from './cloud-service.ts'
import { presence } from './presence.ts'
import { IdParams } from '../platform/responses.ts'

export const cloudController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', SignedIn, async () => cloudService.status())

  app.post('/sessions', SignInRequest, async (req) => cloudService.start(req.body ?? {}))

  app.get('/callback', { schema: { querystring: CallbackQuery } }, async (req, reply) => reply.type('text/html; charset=utf-8').send(await cloudService.finish(req.query)))

  app.post('/sessions/codes', PasteRequest, async (req) => cloudService.pasted(req.body))

  app.delete('/session', SignedIn, async () => cloudService.signOut())

  app.post('/join-codes', SignedIn, async () => cloudService.joinCode())

  app.delete('/devices/:key', NotMeRequest, async (req) => cloudService.notMe({ device: req.params.key, lost: !!req.query.lost }))

  app.patch('/workspaces/:id', UpdateRequest, async (req) => cloudService.update({ workspace: req.params.id, ...req.body }))

  app.get('/workspaces/:id/icon', { ...SignedIn, schema: { params: IdParams } }, async (req, reply) => cloudService.icon({ workspace: req.params.id, reply }))

  app.delete('/', SignedIn, async () => cloudService.deleteData())

  app.get('/presence', SignedIn, async () => presence.view())

  app.put('/presence', HereRequest, async (req) => presence.set(req.body).then(() => presence.view()))

  app.post('/requests', SignedIn, async () => cloudService.ask())

  app.delete('/requests', SignedIn, async () => cloudService.cancelAsk())

  app.delete('/rotations', SignedIn, async () => cloudService.rotated())

  app.delete('/workspaces/:id/members/:email', { onRequest: requireSignIn, schema: { params: z.object({ id: z.string(), email: z.string() }) } }, async (req) => cloudService.remove({ workspace: req.params.id, email: req.params.email }))

  app.delete('/workspaces/:id/invites/:email', { ...SignedIn, schema: { params: z.object({ id: z.string(), email: z.string() }) } }, async (req) => cloudService.revokeInvite({ workspace: req.params.id, email: req.params.email }))

  app.delete('/workspaces/:id/devices/:key', DeviceRequest, async (req) => cloudService.removeDevice({ workspace: req.params.id, device: req.params.key }))

  app.post('/workspaces/:id/keys', { onRequest: requireSignIn, schema: { params: IdParams } }, async (req) => cloudService.changeKeys({ workspace: req.params.id }))

  app.patch('/workspaces/:id/members/:email', RoleRequest, async (req) => cloudService.setRole({ workspace: req.params.id, email: req.params.email, role: req.body.role }))
}

const SignedIn = { onRequest: requireSignIn }
const PasteRequest = { onRequest: requireSignIn, schema: { body: PasteSignInCode } }
const SignInRequest = { onRequest: requireSignIn, schema: { body: StartCloudSignIn } }
const NotMeRequest = { onRequest: requireSignIn, schema: { params: z.object({ key: DeviceKey }), querystring: RemoveDeviceQuery } }
const DeviceRequest = { onRequest: requireSignIn, schema: { params: z.object({ id: z.string(), key: DeviceKey }) } }
const UpdateRequest = { onRequest: requireSignIn, schema: { params: IdParams, body: UpdateWorkspace } }
const RoleRequest = { onRequest: requireSignIn, schema: { params: z.object({ id: z.string(), email: z.string() }), body: ChangeRole } }
const HereRequest = { onRequest: requireSignIn, schema: { body: SetHere } }
const CallbackQuery = z.object({ state: z.optional(z.string()), code: z.optional(z.string()), error: z.optional(z.string()) })
