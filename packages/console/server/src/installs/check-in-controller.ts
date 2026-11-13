import type { FastifyPluginAsync } from 'fastify'
import { CreateCheckIn } from '@jakebox/common/console/console.ts'
import { installService } from './install-service.ts'

export const checkInController: FastifyPluginAsync = async (app) => {
  app.post<{ Body: CreateCheckIn }>('/', CreateRequest, async (req) => installService.checkIn(req.body))
}

const CreateRequest = { schema: { body: CreateCheckIn } }
