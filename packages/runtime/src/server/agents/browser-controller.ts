import type { FastifyPluginAsync } from 'fastify'
import '@fastify/websocket'
import { browserService } from './browser-service.ts'

export const browserController: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string }; Querystring: { fps?: string } }>('/:id/live', { websocket: true }, (socket, req) => browserService.live({ socket, req, agentId: req.params.id, fps: Number(req.query.fps) || 30 }))
}
