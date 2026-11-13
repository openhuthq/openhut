import type { FastifyPluginAsync } from 'fastify'
import { UpdateAdmin } from '@fastmonkey/common/admin/admin.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { adminService } from './admin-service.ts'

export const adminController: FastifyPluginAsync = async (app) => {
  app.get('/', SignedIn, async () => adminService.status())

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
