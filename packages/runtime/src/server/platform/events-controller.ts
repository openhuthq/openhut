import type { FastifyPluginAsync } from 'fastify'
import { TrackEvent } from '@openhut/common/telemetry.ts'
import { who } from '../team/identity.ts'
import '@fastify/websocket'
import { emit } from './events.ts'
import { liveService } from './live-service.ts'

export const eventsController: FastifyPluginAsync = async (app) => {
  app.post<{ Body: TrackEvent }>('/', TrackRequest, async (req, reply) => {
    await who(req)
    emit({ name: 'dashboard.page_viewed', properties: req.body.properties })
    return reply.code(202).send()
  })
  app.get('/', { websocket: true }, (socket, req) => liveService.follow({ socket, req }))
}

const TrackRequest = { schema: { body: TrackEvent } }
