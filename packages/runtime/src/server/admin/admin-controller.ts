import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import * as z from 'zod/mini'
import { CompleteSeatSignIn, UpdateAdmin } from '@openhut/common/admin/admin.ts'
import { admin, requireSignIn } from '../team/identity.ts'
import { adminService } from './admin-service.ts'
import { IdParams } from '../platform/responses.ts'

export const adminController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', SignedIn, async () => adminService.status())

  app.get('/seat-usage', SignedIn, async () => adminService.seatUsage())

  app.post('/seat-sign-ins', AdminOnly, async () => adminService.startSeatSignIn())

  app.patch('/seat-sign-ins/:id', CompleteSeatRequest, async (req) => adminService.completeSeatSignIn({ actor: await admin(req), id: req.params.id, code: req.body.code }))

  app.post('/codex-sign-ins', AdminOnly, async () => adminService.startCodexSignIn())

  app.get('/codex-sign-ins/:id', { schema: { params: IdParams } }, async (req) => adminService.checkCodexSignIn({ actor: await admin(req), id: req.params.id }))

  app.patch('/', UpdateRequest, async (req) => adminService.update({ actor: await admin(req), patch: req.body }))
}

export const updateController: FastifyPluginAsyncZod = async (app) => {
  app.post('/', StartUpdateRequest, async (req) => adminService.startUpdate({ actor: await admin(req), appVersion: req.headers['openhut-app-version'] }))
}

export const healthController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', async (_req, reply) => {
    const health = await adminService.health()
    return reply.status(health.ok ? 200 : 503).send(health)
  })
}

const SignedIn = { onRequest: requireSignIn }
const AdminOnly = { onRequest: async (req: FastifyRequest) => { await admin(req) } }
const UpdateRequest = { schema: { body: UpdateAdmin } }
const CompleteSeatRequest = { schema: { params: IdParams, body: CompleteSeatSignIn } }
// Loose: the rest of the headers (authorization) pass through untouched.
const UpdateHeaders = z.looseObject({ 'openhut-app-version': z.optional(z.string()) })
const StartUpdateRequest = { schema: { headers: UpdateHeaders } }
