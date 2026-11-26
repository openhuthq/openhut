import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { agentService } from '../agents/agent-service.ts'
import { DeleteThread, LookUpFiles, MAX_FILE_BYTES, MirrorThread, ReadFile, SendChat, UploadFile } from '@openhut/common/threads/thread.ts'
import { IdParams, listOf } from '../platform/responses.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { threadService } from './thread-service.ts'

export const threadController: FastifyPluginAsyncZod = async (app) => {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  app.get('/', async (req) => {
    const visible = await agentService.visibleIds({ actor: await who(req) })
    return listOf({ req, data: (await threadService.list()).filter((thread) => visible.has(thread.agentId)) })
  })

  app.get('/:id', { schema: { params: IdParams } }, async (req) => {
    await agentService.requireVisible({ actor: await who(req), id: await threadService.agentIdOf(req.params.id) })
    return threadService.get({ id: req.params.id })
  })

  app.get('/:id/live', { schema: { params: IdParams } }, async (req) => threadService.live({ actor: await who(req), id: req.params.id }))

  app.delete('/:id', DeleteRequest, async (req) => threadService.delete({ actor: await who(req), id: req.params.id, uploads: req.body?.uploads ?? [] }))

  app.post('/:id/mirror', MirrorRequest, async (req) => threadService.mirror({ actor: await who(req), id: req.params.id, paused: req.body.paused }))

  app.post('/:id/chat', ChatRequest, async (req, reply) => threadService.chat({ actor: await who(req), id: req.params.id, body: req.body, reply }))

  app.post('/:id/files', UploadRequest, async (req) => threadService.upload({ actor: await who(req), id: req.params.id, file: req.query, body: req.body }))

  app.delete('/:id/files', DownloadRequest, async (req) => threadService.removeFile({ actor: await who(req), id: req.params.id, path: req.query.path }))

  app.post('/:id/files/lookups', LookUpRequest, async (req) => listOf({ req, data: await threadService.lookUpFiles({ actor: await who(req), id: req.params.id, paths: req.body.paths }) }))

  app.get('/:id/files', DownloadRequest, async (req, reply) => threadService.download({ actor: await who(req), id: req.params.id, path: req.query.path, reply }))
}

const SignedIn = { onRequest: requireSignIn }
const ChatRequest = { schema: { params: IdParams, body: SendChat } }
const MirrorRequest = { schema: { params: IdParams, body: MirrorThread } }
const DeleteRequest = { schema: { params: IdParams, body: DeleteThread } }
const UploadRequest = { onRequest: requireSignIn, bodyLimit: MAX_FILE_BYTES, schema: { params: IdParams, querystring: UploadFile } }
const DownloadRequest = { schema: { params: IdParams, querystring: ReadFile } }
const LookUpRequest = { schema: { params: IdParams, body: LookUpFiles } }
