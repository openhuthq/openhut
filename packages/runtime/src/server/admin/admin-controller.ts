import type { FastifyPluginAsync } from 'fastify'
import { CompleteSeatSignIn, CreateExport, CreateImport, UpdateAdmin } from '@openhut/common/admin/admin.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { adminService } from './admin-service.ts'

export const adminController: FastifyPluginAsync = async (app) => {
  app.get('/', SignedIn, async () => adminService.status())

  app.get('/seat-usage', SignedIn, async () => adminService.seatUsage())

  app.post('/seat-sign-ins', SignedIn, async () => adminService.startSeatSignIn())

  app.patch<{ Params: { id: string }; Body: CompleteSeatSignIn }>('/seat-sign-ins/:id', CompleteSeatRequest, async (req) => adminService.completeSeatSignIn({ actor: await who(req), id: req.params.id, code: req.body.code }))

  app.post('/codex-sign-ins', SignedIn, async () => adminService.startCodexSignIn())

  app.get<{ Params: { id: string } }>('/codex-sign-ins/:id', async (req) => adminService.checkCodexSignIn({ actor: await who(req), id: req.params.id }))

  app.post<{ Body: CreateExport }>('/exports', ExportRequest, async (req) => adminService.exportSealed({ actor: await who(req), ...req.body }))

  app.post<{ Body: CreateImport }>('/imports', ImportRequest, async (req) => adminService.importSealed({ actor: await who(req), sealed: req.body.sealed }))

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
const ExportRequest = { schema: { body: CreateExport } }
const ImportRequest = { schema: { body: CreateImport } }
