import type { FastifyPluginAsync } from 'fastify'
import * as z from 'zod/mini'
import { AddPasskey, AddRuntime, AllowDevice, ChangeRole, DeviceKey, RenameWorkspace, RuntimeInvite, UnlockCloud } from '@openhut/common/cloud/cloud.ts'
import { requireSignIn } from '../team/identity.ts'
import { cloudService } from './cloud-service.ts'

export const cloudController: FastifyPluginAsync = async (app) => {
  app.get('/', SignedIn, async () => cloudService.status())

  app.post('/sessions', SignedIn, async () => cloudService.start())

  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/callback', async (req, reply) => reply.type('text/html; charset=utf-8').send(await cloudService.finish(req.query)))

  app.delete('/session', SignedIn, async () => cloudService.signOut())

  app.post('/kits', SignedIn, async () => cloudService.newKit())

  app.delete('/account', SignedIn, async () => cloudService.forget())

  app.delete('/key-boxes', SignedIn, async () => cloudService.startOver())

  app.post<{ Body: UnlockCloud }>('/unlock', UnlockRequest, async (req) => cloudService.unlock(req.body))

  app.post<{ Body: AddRuntime }>('/runtimes', AddRuntimeRequest, async (req) => cloudService.addRuntime(req.body))

  app.post<{ Body: RuntimeInvite }>('/join', JoinRequest, async (req) => cloudService.join(req.body))

  app.post('/pairings', SignedIn, async () => cloudService.startPairing())

  app.post<{ Body: AllowDevice }>('/devices', AllowRequest, async (req) => cloudService.allow(req.body))

  app.delete<{ Params: { key: string } }>('/devices/:key', NotMeRequest, async (req) => cloudService.notMe({ device: req.params.key }))

  app.post<{ Body: AddPasskey }>('/passkeys', PasskeyRequest, async (req) => cloudService.addPasskey(req.body))

  app.patch<{ Params: { id: string }; Body: RenameWorkspace }>('/workspaces/:id', RenameRequest, async (req) => cloudService.rename({ workspace: req.params.id, name: req.body.name }))

  app.patch<{ Params: { id: string; email: string }; Body: ChangeRole }>('/workspaces/:id/members/:email', RoleRequest, async (req) => cloudService.setRole({ workspace: req.params.id, email: req.params.email, role: req.body.role }))
}

const SignedIn = { onRequest: requireSignIn }
const UnlockRequest = { onRequest: requireSignIn, schema: { body: UnlockCloud } }
const AddRuntimeRequest = { onRequest: requireSignIn, schema: { body: AddRuntime } }
const JoinRequest = { onRequest: requireSignIn, schema: { body: RuntimeInvite } }
const AllowRequest = { onRequest: requireSignIn, schema: { body: AllowDevice } }
const NotMeRequest = { onRequest: requireSignIn, schema: { params: z.object({ key: DeviceKey }) } }
const PasskeyRequest = { onRequest: requireSignIn, schema: { body: AddPasskey } }
const RenameRequest = { onRequest: requireSignIn, schema: { body: RenameWorkspace } }
const RoleRequest = { onRequest: requireSignIn, schema: { body: ChangeRole } }
