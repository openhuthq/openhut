import type { FastifyPluginAsync } from 'fastify'
import { BrowserInput } from '@openhut/common/agents/browser.ts'
import { who } from '../team/identity.ts'
import { browserService } from './browser-service.ts'

export const browserController: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { id: string } }>('/:id', async (req) => browserService.get({ actor: await who(req), agentId: req.params.id }))

  app.get<{ Params: { id: string } }>('/:id/stream', async (req, reply) => browserService.stream({ actor: await who(req), agentId: req.params.id, req, reply }))

  app.get<{ Params: { id: string } }>('/:id/frames', async (req, reply) => browserService.frames({ actor: await who(req), agentId: req.params.id, req, reply }))

  app.post<{ Params: { id: string } }>('/:id/hold', async (req) => browserService.hold({ actor: await who(req), agentId: req.params.id }))

  app.delete<{ Params: { id: string } }>('/:id/hold', async (req) => browserService.release({ actor: await who(req), agentId: req.params.id }))

  app.post<{ Params: { id: string }; Body: BrowserInput }>('/:id/input', InputRequest, async (req) => browserService.input({ actor: await who(req), agentId: req.params.id, events: req.body.events }))
}

const InputRequest = { schema: { body: BrowserInput } }
