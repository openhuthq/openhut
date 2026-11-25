import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import * as z from 'zod/mini'
import { AddPasskey, ApproveRequest, ChangeRole, CreateWebLink, DenyRequestQuery, DeviceKey, PasteSignInCode, RemoveDeviceQuery, SetHere, StartCloudSignIn, UnlockCloud, UpdateWorkspace } from '@openhut/common/cloud/cloud.ts'
import { requireSignIn, withPresence } from '../team/identity.ts'
import { cloudService } from './cloud-service.ts'
import { presence } from './presence.ts'
import { IdParams } from '../platform/responses.ts'

export const cloudController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', SignedIn, async () => cloudService.status())

  app.post('/sessions', SignInRequest, async (req) => cloudService.start(req.body ?? {}))

  app.get('/callback', { schema: { querystring: CallbackQuery } }, async (req, reply) => reply.type('text/html; charset=utf-8').send(await cloudService.finish(req.query)))

  app.post('/sessions/codes', PasteRequest, async (req) => cloudService.pasted(req.body))

  app.delete('/session', SignedIn, async () => cloudService.signOut())

  app.post('/kits', { onRequest: withPresence('save a new recovery kit') }, async () => cloudService.newKit())

  app.post('/join-codes', SignedIn, async () => cloudService.joinCode())

  app.post('/web-links', WebLinkRequest, async (req) => cloudService.continueInWeb(req.body))

  app.post('/unlock', UnlockRequest, async (req) => cloudService.unlock(req.body))

  app.delete('/devices/:key', NotMeRequest, async (req) => cloudService.notMe({ device: req.params.key, lost: !!req.query.lost }))

  app.post('/passkeys', PasskeyRequest, async (req) => cloudService.addPasskey(req.body))

  app.delete('/passkeys', async () => cloudService.removePasskey())

  app.patch('/workspaces/:id', UpdateRequest, async (req) => cloudService.update({ workspace: req.params.id, ...req.body }))

  app.get('/workspaces/:id/icon', { ...SignedIn, schema: { params: IdParams } }, async (req, reply) => cloudService.icon({ workspace: req.params.id, reply }))

  app.delete('/', { onRequest: withPresence('delete your OpenHut data') }, async () => cloudService.deleteData())

  app.get('/presence', SignedIn, async () => presence.view())

  app.put('/presence', HereRequest, async (req) => presence.set(req.body).then(() => presence.view()))

  app.post('/requests', SignedIn, async () => cloudService.ask())

  app.delete('/requests', SignedIn, async () => cloudService.cancelAsk())

  app.delete('/rotations', SignedIn, async () => cloudService.rotated())

  app.delete('/workspaces/:id/members/:email', { schema: { params: z.object({ id: z.string(), email: z.string() }) }, onRequest: withPresence('remove someone from your team') }, async (req) => cloudService.remove({ workspace: req.params.id, email: req.params.email }))

  app.delete('/workspaces/:id/invites/:email', { ...SignedIn, schema: { params: z.object({ id: z.string(), email: z.string() }) } }, async (req) => cloudService.revokeInvite({ workspace: req.params.id, email: req.params.email }))

  app.delete('/workspaces/:id/devices/:key', DeviceRequest, async (req) => cloudService.removeDevice({ workspace: req.params.id, device: req.params.key }))

  app.post('/workspaces/:id/keys', { schema: { params: IdParams }, onRequest: withPresence('reset your team’s encryption') }, async (req) => cloudService.changeKeys({ workspace: req.params.id }))

  app.post('/workspaces/:id/requests/:device/approvals', ApproveRequestRequest, async (req) => cloudService.approve({ workspace: req.params.id, device: req.params.device, faces: req.body?.faces }))

  app.post('/workspaces/:id/requests/:device/reviews', { ...SignedIn, schema: { params: z.object({ id: z.string(), device: z.string() }) } }, async (req) => cloudService.review({ workspace: req.params.id, device: req.params.device }))

  app.delete('/workspaces/:id/requests/:device', DenyRequestRequest, async (req) => cloudService.deny({ workspace: req.params.id, device: req.params.device, why: req.query.why }))

  app.patch('/workspaces/:id/members/:email', RoleRequest, async (req) => cloudService.setRole({ workspace: req.params.id, email: req.params.email, role: req.body.role }))
}

const SignedIn = { onRequest: requireSignIn }
const PasteRequest = { onRequest: requireSignIn, schema: { body: PasteSignInCode } }
const SignInRequest = { onRequest: requireSignIn, schema: { body: StartCloudSignIn } }
const UnlockRequest = { onRequest: requireSignIn, schema: { body: UnlockCloud } }
const NotMeRequest = { onRequest: withPresence('remove a device from OpenHut'), schema: { params: z.object({ key: DeviceKey }), querystring: RemoveDeviceQuery } }
const DeviceRequest = { onRequest: withPresence('remove a device from OpenHut'), schema: { params: z.object({ id: z.string(), key: DeviceKey }) } }
const PasskeyRequest = { onRequest: requireSignIn, schema: { body: AddPasskey } }
const UpdateRequest = { onRequest: requireSignIn, schema: { params: IdParams, body: UpdateWorkspace } }
const RoleRequest = { onRequest: requireSignIn, schema: { params: z.object({ id: z.string(), email: z.string() }), body: ChangeRole } }
const WebLinkRequest = { onRequest: requireSignIn, schema: { body: CreateWebLink } }
const HereRequest = { onRequest: requireSignIn, schema: { body: SetHere } }
const ApproveRequestRequest = { onRequest: requireSignIn, schema: { params: z.object({ id: z.string(), device: z.string() }), body: z.optional(ApproveRequest) } }
const DenyRequestRequest = { onRequest: requireSignIn, schema: { params: z.object({ id: z.string(), device: z.string() }), querystring: DenyRequestQuery } }
const CallbackQuery = z.object({ state: z.optional(z.string()), code: z.optional(z.string()), error: z.optional(z.string()) })
