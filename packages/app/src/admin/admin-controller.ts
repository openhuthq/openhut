import type { FastifyPluginAsync } from 'fastify'
import { CompleteSeatSignIn, UpdateAdmin } from '@openhut/common/admin/admin.ts'
import { listOf } from '../platform/responses.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { adminService } from './admin-service.ts'

export const adminController: FastifyPluginAsync = async (app) => {
  app.get('/', SignedIn, async () => adminService.status())

  app.get('/seat-usage', SignedIn, async () => adminService.seatUsage())

  app.post('/seat-sign-ins', async (req) => adminService.startSeatSignIn({ actor: await who(req) }))

  app.patch<{ Params: { id: string }; Body: CompleteSeatSignIn }>('/seat-sign-ins/:id', CompleteSeatRequest, async (req) => adminService.completeSeatSignIn({ actor: await who(req), id: req.params.id, code: req.body.code }))

  app.get('/containers', async (req) => listOf({ req, data: await adminService.containers({ actor: await who(req) }) }))

  app.patch<{ Body: UpdateAdmin }>('/', UpdateRequest, async (req) => adminService.update({ actor: await who(req), patch: req.body }))
}

export const updateController: FastifyPluginAsync = async (app) => {
  app.post('/', SignedIn, async (req) => adminService.startUpdate({ actor: await who(req) }))
}

export const healthController: FastifyPluginAsync = async (app) => {
  app.get('/', async (_req, reply) => {
    const health = await adminService.health()
    return reply.status(health.ok ? 200 : 503).send(health)
  })
}

const SignedIn = { onRequest: requireSignIn }
const UpdateRequest = { schema: { body: UpdateAdmin } }
const CompleteSeatRequest = { schema: { body: CompleteSeatSignIn } }
