import type { FastifyPluginAsync } from 'fastify'
import { DeleteThread, LookUpFiles, MAX_FILE_BYTES, ReadFile, SendChat, UploadFile } from '@openhut/common/threads/thread.ts'
import { listOf } from '../platform/responses.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { threadService } from './thread-service.ts'

export const threadController: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  app.get('/', SignedIn, async (req) => listOf({ req, data: await threadService.list() }))

  app.get<{ Params: { id: string } }>('/:id', SignedIn, async (req) => threadService.get({ id: req.params.id }))

  app.delete<{ Params: { id: string }; Body: DeleteThread }>('/:id', DeleteRequest, async (req) => threadService.delete({ actor: await who(req), id: req.params.id, uploads: req.body?.uploads ?? [] }))

  app.post<{ Params: { id: string }; Body: SendChat }>('/:id/chat', ChatRequest, async (req, reply) => threadService.chat({ actor: await who(req), id: req.params.id, body: req.body, reply }))

  app.post<{ Params: { id: string }; Querystring: UploadFile; Body: unknown }>('/:id/files', UploadRequest, async (req) => threadService.upload({ actor: await who(req), id: req.params.id, file: req.query, body: req.body }))

  app.delete<{ Params: { id: string }; Querystring: ReadFile }>('/:id/files', DownloadRequest, async (req) => threadService.removeFile({ actor: await who(req), id: req.params.id, path: req.query.path }))

  app.post<{ Params: { id: string }; Body: LookUpFiles }>('/:id/files/lookups', LookUpRequest, async (req) => listOf({ req, data: await threadService.lookUpFiles({ actor: await who(req), id: req.params.id, paths: req.body.paths }) }))

  app.get<{ Params: { id: string }; Querystring: ReadFile }>('/:id/files', DownloadRequest, async (req, reply) => threadService.download({ actor: await who(req), id: req.params.id, path: req.query.path, reply }))
}

const SignedIn = { onRequest: requireSignIn }
const ChatRequest = { schema: { body: SendChat } }
const DeleteRequest = { schema: { body: DeleteThread } }
const UploadRequest = { onRequest: requireSignIn, bodyLimit: MAX_FILE_BYTES, schema: { querystring: UploadFile } }
const DownloadRequest = { schema: { querystring: ReadFile } }
const LookUpRequest = { schema: { body: LookUpFiles } }
