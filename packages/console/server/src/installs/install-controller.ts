import type { FastifyPluginAsync } from 'fastify'
import { ListQuery } from '@jakebox/common/api.ts'
import { requirePublishKey } from '../platform/publish-key.ts'
import { listOf } from '../platform/responses.ts'
import { installService } from './install-service.ts'

export const installController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>('/', ListRequest, async (req) => listOf({ req, ...await installService.list(req.query) }))
}

const ListRequest = { onRequest: requirePublishKey, schema: { querystring: ListQuery } }
