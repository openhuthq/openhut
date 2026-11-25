import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import '@fastify/websocket'
import * as z from 'zod/mini'
import { browserService } from './browser-service.ts'
import { IdParams } from '../platform/responses.ts'

export const browserController: FastifyPluginAsyncZod = async (app) => {
  app.get('/:id/live', { websocket: true, schema: { params: IdParams, querystring: LiveQuery } }, (socket, req) => browserService.live({ socket, req, agentId: req.params.id, fps: req.query.fps }))
}

const LiveQuery = z.object({ fps: z._default(z.coerce.number().check(z.int(), z.minimum(1), z.maximum(60)), 30) })
