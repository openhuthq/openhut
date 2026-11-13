import type { FastifyPluginAsync } from 'fastify'
import { CreateRelease, ListConsoleObjects } from '@jakebox/common/console/console.ts'
import { requirePublishKey } from '../platform/publish-key.ts'
import { listOf } from '../platform/responses.ts'
import { releaseService } from './release-service.ts'

export const releaseController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListConsoleObjects }>('/', ListRequest, async (req) => listOf({ req, ...await releaseService.list(req.query) }))

  app.get('/latest', async () => releaseService.latest())

  app.post<{ Body: CreateRelease }>('/', CreateRequest, async (req) => releaseService.create(req.body))
}

const ListRequest = { schema: { querystring: ListConsoleObjects } }
const CreateRequest = { onRequest: requirePublishKey, schema: { body: CreateRelease } }
