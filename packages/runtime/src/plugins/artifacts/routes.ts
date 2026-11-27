import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import * as z from 'zod'
import { UpdateArtifact } from '@openhut/common/artifacts.ts'
import { IdParams } from '../../server/platform/responses.ts'
import { who } from '../../server/team/identity.ts'
import { artifactService } from './service.ts'

const SANDBOX = 'sandbox allow-scripts allow-forms allow-popups allow-modals; frame-ancestors \'self\''

export const artifactController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListRequest, async (req) => artifactService.list({ actor: await who(req), agentId: req.query.agent }))
  app.get('/:id', { schema: { params: IdParams } }, async (req) => artifactService.view({ actor: await who(req), id: req.params.id }))
  app.patch('/:id', UpdateRequest, async (req) => artifactService.update({ actor: await who(req), id: req.params.id, patch: req.body }))
  app.post('/:id/link', { schema: { params: IdParams } }, async (req) => artifactService.resetLink({ actor: await who(req), id: req.params.id }))
  app.delete('/:id', { schema: { params: IdParams } }, async (req, reply) => {
    await artifactService.remove({ actor: await who(req), id: req.params.id })
    return reply.status(204).send()
  })
}

export const shareController: FastifyPluginAsyncZod = async (app) => {
  app.get('/:token', { schema: { params: z.object({ token: z.string().max(100) }) } }, async (req) => artifactService.shared({ token: req.params.token }))
}

export const fileController: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onSend', async (_req, reply) => { reply.removeHeader('x-frame-options') })
  app.get('/:id/:sig/*', FileRequest, async (req, reply) => {
    const file = await artifactService.file({ id: req.params.id, sig: req.params.sig, path: req.params['*'] })
    const pdf = file.type === 'application/pdf'
    reply.header('content-type', file.type).header('x-content-type-options', 'nosniff').header('cache-control', 'private, no-cache')
      .header('content-security-policy', pdf ? 'frame-ancestors \'self\'' : SANDBOX)
    if (file.kind === 'file') reply.header('content-disposition', `attachment; filename="${file.name.replace(/[^\w.-]/g, '_')}"`)
    else if (pdf) reply.header('content-disposition', 'inline')
    return reply.send(Buffer.from(file.body))
  })
}

const ListRequest = { schema: { querystring: z.object({ agent: z.string().max(60) }) } }
const UpdateRequest = { schema: { params: IdParams, body: UpdateArtifact } }
const FileRequest = { schema: { params: z.object({ id: z.string().max(60), sig: z.string().max(100), '*': z.string().max(400) }) } }
