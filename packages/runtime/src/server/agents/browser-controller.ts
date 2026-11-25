import type { FastifyPluginAsync } from 'fastify'
import '@fastify/websocket'
import * as z from 'zod/mini'
import { browserService } from './browser-service.ts'

export const browserController: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string }; Querystring: LiveQuery }>('/:id/live', { websocket: true, schema: { querystring: LiveQuery } }, (socket, req) => browserService.live({ socket, req, agentId: req.params.id, fps: req.query.fps }))
}

const LiveQuery = z.object({ fps: z._default(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(60)), 30) })
type LiveQuery = z.infer<typeof LiveQuery>
