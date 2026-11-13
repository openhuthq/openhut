import type { FastifyPluginAsync } from 'fastify'
import { CreateChannel, ListChannels, UpdateChannel } from '@fastmonkey/common/channels/channel.ts'
import { listOf } from '../platform/responses.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { channelService } from './channel-service.ts'

export const channelController: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListChannels }>('/', ListRequest, async (req) => listOf({ req, data: await channelService.list(req.query) }))

  app.post<{ Body: CreateChannel }>('/', CreateRequest, async (req) => channelService.create({ actor: await who(req), ...req.body }))

  app.get<{ Params: { id: string } }>('/:id', async (req) => channelService.get({ actor: await who(req), id: req.params.id }))

  app.patch<{ Params: { id: string }; Body: UpdateChannel }>('/:id', UpdateRequest, async (req) => channelService.update({ actor: await who(req), id: req.params.id, patch: req.body }))

  app.delete<{ Params: { id: string } }>('/:id', async (req) => channelService.delete({ actor: await who(req), id: req.params.id }))
}

const ListRequest = { onRequest: requireSignIn, schema: { querystring: ListChannels } }
const CreateRequest = { schema: { body: CreateChannel } }
const UpdateRequest = { schema: { body: UpdateChannel } }
