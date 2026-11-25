import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import '@fastify/websocket'
import { liveService } from './live-service.ts'

export const eventsController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', { websocket: true }, (socket, req) => liveService.follow({ socket, req }))
}
