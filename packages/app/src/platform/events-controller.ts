import type { FastifyPluginAsync } from 'fastify'
import { TrackEvent } from '@openhut/common/telemetry.ts'
import { who } from '../team/identity.ts'
import { track } from './events.ts'

export const eventsController: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TrackEvent }>('/', TrackRequest, async (req, reply) => {
    await who(req)
    track(req.body.name, req.body.properties)
    return reply.code(202).send()
  })
}

const TrackRequest = { schema: { body: TrackEvent } }
