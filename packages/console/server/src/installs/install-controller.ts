import type { FastifyPluginAsync } from 'fastify'
import { CheckIn, ListConsoleObjects } from '@jakebox/common/console/console.ts'
import { requirePublishKey } from '../platform/publish-key.ts'
import { listOf } from '../platform/responses.ts'
import { installService } from './install-service.ts'

export const installController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListConsoleObjects }>('/', ListRequest, async (req) => listOf({ req, ...await installService.list(req.query) }))

  app.post<{ Body: CheckIn }>('/', CheckInRequest, async (req) => installService.checkIn(req.body))
}

const ListRequest = { onRequest: requirePublishKey, schema: { querystring: ListConsoleObjects } }
const CheckInRequest = { schema: { body: CheckIn } }
