import type { FastifyPluginAsync } from 'fastify'
import { CreateThread, MAX_FILE_BYTES, ReadFile, SendChat, UploadFile } from '@openhut/common/threads/thread.ts'
import { listOf } from '../platform/responses.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { threadService } from './thread-service.ts'

export const threadController: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  app.get('/', async (req) => listOf({ req, data: await threadService.list({ actor: await who(req) }) }))

  app.post<{ Body: CreateThread }>('/', CreateRequest, async (req) => threadService.create({ actor: await who(req), agentId: req.body.agentId }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => threadService.get({ actor: await who(req), id: req.params.id }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => threadService.delete({ actor: await who(req), id: req.params.id }))

  app.post<{ Params: { id: string }; Body: SendChat }>('/:id/chat', ChatRequest, async (req, reply) => threadService.chat({ actor: await who(req), id: req.params.id, body: req.body, reply }))

  app.post<{ Params: { id: string }; Querystring: UploadFile; Body: unknown }>('/:id/files', UploadRequest, async (req) => threadService.upload({ actor: await who(req), id: req.params.id, file: req.query, body: req.body }))

  app.get<{ Params: { id: string }; Querystring: ReadFile }>('/:id/files', DownloadRequest, async (req, reply) => threadService.download({ actor: await who(req), id: req.params.id, path: req.query.path, reply }))
}

const CreateRequest = { schema: { body: CreateThread } }
const ChatRequest = { schema: { body: SendChat } }
const UploadRequest = { onRequest: requireSignIn, bodyLimit: MAX_FILE_BYTES, schema: { querystring: UploadFile } }
const DownloadRequest = { schema: { querystring: ReadFile } }
