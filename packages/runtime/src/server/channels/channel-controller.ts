import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { agentService } from '../agents/agent-service.ts'
import { CreateChannel, ListChannels, UpdateChannel } from '@openhut/common/channels/channel.ts'
import { IdParams, listOf } from '../platform/responses.ts'
import { requireSignIn, who } from '../team/identity.ts'
import { channelService } from './channel-service.ts'

export const channelController: FastifyPluginAsyncZod = async (app) => {
  app.get('/', ListRequest, async (req) => {
    const visible = await agentService.visibleIds({ actor: await who(req) })
    return listOf({ req, data: (await channelService.list(req.query)).filter((channel) => visible.has(channel.agentId)) })
  })

  app.post('/', CreateRequest, async (req) => channelService.create({ actor: await who(req), ...req.body }))

  app.get('/:id/conversations', { schema: { params: IdParams } }, async (req) => listOf({ req, data: await channelService.conversations({ actor: await who(req), id: req.params.id }) }))

  app.get('/:id', { schema: { params: IdParams } }, async (req) => channelService.get({ actor: await who(req), id: req.params.id }))

  app.patch('/:id', UpdateRequest, async (req) => channelService.update({ actor: await who(req), id: req.params.id, patch: req.body }))

  app.post('/:id/telegram-invites', { schema: { params: IdParams } }, async (req) => channelService.telegramInvite({ actor: await who(req), id: req.params.id }))

  app.delete('/:id', { schema: { params: IdParams } }, async (req) => channelService.delete({ actor: await who(req), id: req.params.id }))
}

const ListRequest = { onRequest: requireSignIn, schema: { querystring: ListChannels } }
const CreateRequest = { schema: { body: CreateChannel } }
const UpdateRequest = { schema: { params: IdParams, body: UpdateChannel } }
