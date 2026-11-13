import type { FastifyPluginAsync } from 'fastify'
import { ListQuery } from '@jakebox/common/api.ts'
import { CreateRelease } from '@jakebox/common/console/console.ts'
import { requirePublishKey } from '../platform/publish-key.ts'
import { listOf } from '../platform/responses.ts'
import { releaseService } from './release-service.ts'

export const releaseController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>('/', ListRequest, async (req) => listOf({ req, ...await releaseService.list(req.query) }))

  app.post<{ Body: CreateRelease }>('/', CreateRequest, async (req) => releaseService.create(req.body))
}

const ListRequest = { schema: { querystring: ListQuery } }
const CreateRequest = { onRequest: requirePublishKey, schema: { body: CreateRelease } }
