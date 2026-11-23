import type { FastifyPluginAsync } from 'fastify'
import '@fastify/websocket'
import { liveService } from './live-service.ts'

export const eventsController: FastifyPluginAsync = async (app) => {
  app.get('/', { websocket: true }, (socket, req) => liveService.follow({ socket, req }))
}
