import type { FastifyPluginAsync } from 'fastify'
import * as z from 'zod/mini'
import { AddPasskey, AddRuntime, ChangeRole, CreateWorkspace, DeleteWorkspace, DeviceKey, RuntimeInvite, SetHere, UnlockCloud, UpdateWorkspace } from '@openhut/common/cloud/cloud.ts'
import { requireSignIn } from '../team/identity.ts'
import { cloudService } from './cloud-service.ts'
import { syncService } from './sync-service.ts'

export const cloudController: FastifyPluginAsync = async (app) => {
  app.get('/', SignedIn, async () => cloudService.status())

  app.post('/sessions', SignedIn, async () => cloudService.start())

  app.get<{ Querystring: { state?: string; code?: string; error?: string } }>('/callback', async (req, reply) => reply.type('text/html; charset=utf-8').send(await cloudService.finish(req.query)))

  app.delete('/session', SignedIn, async () => cloudService.signOut())

  app.post('/kits', SignedIn, async () => cloudService.newKit())

  app.post<{ Body: UnlockCloud }>('/unlock', UnlockRequest, async (req) => cloudService.unlock(req.body))

  app.post<{ Body: AddRuntime }>('/runtimes', AddRuntimeRequest, async (req) => cloudService.addRuntime(req.body))

  app.post<{ Body: RuntimeInvite }>('/join', JoinRequest, async (req) => cloudService.join(req.body))

  app.delete<{ Params: { key: string } }>('/devices/:key', NotMeRequest, async (req) => cloudService.notMe({ device: req.params.key }))

  app.post<{ Body: AddPasskey }>('/passkeys', PasskeyRequest, async (req) => cloudService.addPasskey(req.body))

  app.patch<{ Params: { id: string }; Body: UpdateWorkspace }>('/workspaces/:id', UpdateRequest, async (req) => cloudService.update({ workspace: req.params.id, ...req.body }))

  app.get<{ Params: { id: string } }>('/workspaces/:id/icon', SignedIn, async (req, reply) => cloudService.icon({ workspace: req.params.id, reply }))

  app.delete('/', SignedIn, async () => cloudService.deleteData())

  app.get('/presence', SignedIn, async () => syncService.presence())

  app.post<{ Body: SetHere }>('/here', HereRequest, async (req) => syncService.here(req.body).then(() => syncService.presence()))

  app.post('/requests', SignedIn, async () => cloudService.ask())

  app.delete('/requests', SignedIn, async () => cloudService.cancelAsk())

  app.delete('/rotations', SignedIn, async () => cloudService.rotated())

  app.post<{ Body: CreateWorkspace }>('/workspaces', CreateRequest, async (req) => cloudService.create(req.body))

  app.delete<{ Params: { id: string }; Body: DeleteWorkspace }>('/workspaces/:id', DeleteRequest, async (req) => cloudService.deleteWorkspace({ workspace: req.params.id, name: req.body.name }))

  app.delete<{ Params: { id: string; email: string } }>('/workspaces/:id/members/:email', SignedIn, async (req) => cloudService.remove({ workspace: req.params.id, email: req.params.email }))

  app.delete<{ Params: { id: string; email: string } }>('/workspaces/:id/invites/:email', SignedIn, async (req) => cloudService.revokeInvite({ workspace: req.params.id, email: req.params.email }))

  app.delete<{ Params: { id: string; key: string } }>('/workspaces/:id/devices/:key', DeviceRequest, async (req) => cloudService.removeDevice({ workspace: req.params.id, device: req.params.key }))

  app.post<{ Params: { id: string } }>('/workspaces/:id/keys', SignedIn, async (req) => cloudService.changeKeys({ workspace: req.params.id }))

  app.post<{ Params: { id: string; device: string } }>('/workspaces/:id/requests/:device/approvals', SignedIn, async (req) => cloudService.approve({ workspace: req.params.id, device: req.params.device }))

  app.delete<{ Params: { id: string; device: string } }>('/workspaces/:id/requests/:device', SignedIn, async (req) => cloudService.deny({ workspace: req.params.id, device: req.params.device }))

  app.patch<{ Params: { id: string; email: string }; Body: ChangeRole }>('/workspaces/:id/members/:email', RoleRequest, async (req) => cloudService.setRole({ workspace: req.params.id, email: req.params.email, role: req.body.role }))
}

const SignedIn = { onRequest: requireSignIn }
const UnlockRequest = { onRequest: requireSignIn, schema: { body: UnlockCloud } }
const AddRuntimeRequest = { onRequest: requireSignIn, schema: { body: AddRuntime } }
const JoinRequest = { onRequest: requireSignIn, schema: { body: RuntimeInvite } }
const NotMeRequest = { onRequest: requireSignIn, schema: { params: z.object({ key: DeviceKey }) } }
const DeviceRequest = { onRequest: requireSignIn, schema: { params: z.object({ id: z.string(), key: DeviceKey }) } }
const PasskeyRequest = { onRequest: requireSignIn, schema: { body: AddPasskey } }
const UpdateRequest = { onRequest: requireSignIn, schema: { body: UpdateWorkspace } }
const RoleRequest = { onRequest: requireSignIn, schema: { body: ChangeRole } }
const CreateRequest = { onRequest: requireSignIn, schema: { body: CreateWorkspace } }
const DeleteRequest = { onRequest: requireSignIn, schema: { body: DeleteWorkspace } }
const HereRequest = { onRequest: requireSignIn, schema: { body: SetHere } }
