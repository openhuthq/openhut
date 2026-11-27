import * as z from 'zod'
import { CreateChannel, type Audience, type ChannelKind } from '@openhut/common/channels/channel.ts'
import * as mini from 'zod/mini'
import { defineAsk, definePlugin } from '../../core/plugin.ts'
import { db } from '../../server/platform/db.ts'
import { config } from '../../server/platform/config.ts'
import { WHATSAPP_PORT_BASE } from '../../agentd/network/ports.ts'
import { slack } from '../../server/integrations/slack/slack.ts'
import { telegram } from '../../server/integrations/telegram/telegram.ts'
import { whatsapp } from '../../server/integrations/whatsapp/whatsapp.ts'
import { channelService } from '../../server/channels/channel-service.ts'
import { channelController } from '../../server/channels/channel-controller.ts'
import { placeController } from '../../server/channels/place-controller.ts'
import { log } from '../../server/platform/events.ts'
import { describeIssues, HttpError, messageOf } from '../../server/platform/http-error.ts'
import { createTables } from './tables.ts'

const INVITE = /^\/start(?:@\w+)?\s+([\w-]{16,64})$/
const TELEGRAM_USER = /^[1-9]\d{4,14}$/
export type RenderedChannel =
  | { kind: Extract<ChannelKind, 'slack'>; audience: Audience }
  | { kind: Extract<ChannelKind, 'telegram'>; audience: Audience }
  | { kind: Extract<ChannelKind, 'discord'>; audience: Audience }
  | { kind: Extract<ChannelKind, 'whatsapp'>; audience: Audience }

export const channels = definePlugin({
  name: 'channels',
  migrate: createTables,
  routes: () => ({ '/api/channels': channelController, '/api/agents/:id/places': placeController }),
  start: () => void channelService.resumeTelegramClaims().catch((err: unknown) => log.warn({ event: 'telegram.claim_resume_failed', error: messageOf(err) })),
  agent: ({ agent, channels: list, gateway, token }) => {
    const parts = list.map((channel) => partOf({ channel, gateway, token, net: agent.net }))
    return {
      native: { hermes: { config: Object.assign({}, ...parts.map((part) => part.config)), env: Object.assign({}, ...parts.map((part) => part.env)) } },
      restart: list.filter((channel) => channel.kind !== 'discord').map((channel) => channel.kind === 'telegram' ? channel.kind : channel),
    }
  },
  asks: {
    add_channel: defineAsk({
      input: z.object({
        kind: z.enum(['whatsapp', 'telegram', 'discord']),
        ownerAddress: z.string().max(40).optional().describe('WhatsApp and Telegram: your owner\'s WhatsApp number with country code (+15551234567), or their numeric Telegram user ID.'),
        open: z.boolean().optional().describe('WhatsApp and Telegram: true lets anyone message you; false only your owner and allowed.'),
        allowed: z.array(z.string().max(40)).max(50).default([]).describe('Other numbers or Telegram IDs that may message you. For Discord: the channel IDs to answer in.'),
        botToken: z.string().max(200).optional().describe('For Telegram: the token BotFather gave, like 123456789:AAE…. For Discord: the bot token from the Developer Portal\'s Bot page.'),
      }),
      tool: 'Ask to add WhatsApp, Telegram or Discord, so people can message you there. Slack needs a Slack app, so your owner adds it in OpenHut.',
      title: async ({ agentId, input }) => {
        newChannel({ agentId, input })
        if (await db.selectFrom('channel').select('id').where('agent_id', '=', agentId).where('kind', '=', input.kind).executeTakeFirst()) throw new HttpError(409, `You already have ${LABEL[input.kind]}. Ask your owner to remove it in OpenHut first, or ask to change it with update_channel.`)
        return `Add ${LABEL[input.kind]}${input.open ? ', open to anyone' : ''}`
      },
      run: async ({ actor, ask: { agentId, input } }) => {
        await channelService.create({ actor, ...newChannel({ agentId, input }) }).catch(alreadyDone(409))
        return input.kind === 'whatsapp' ? 'WhatsApp links once your owner scans the QR code on your page in OpenHut.' : 'You have already restarted with it.'
      },
    }),
    update_channel: defineAsk({
      input: z.object({ id: z.string().max(40), open: z.boolean().optional(), allowed: z.array(z.string().max(20)).max(50).optional().describe('The whole new list.') })
        .refine((change) => change.open !== undefined || change.allowed !== undefined, 'Send open, allowed, or both.'),
      tool: 'Ask to change who can message you on one of your channels.',
      title: async ({ agentId, input }) => `Change who can message it on ${LABEL[(await ownChannel({ agentId, id: input.id })).kind]}`,
      run: async ({ actor, ask: { agentId, input: { id, ...patch } } }) => {
        await ownChannel({ agentId, id })
        await channelService.update({ actor, id, patch })
        return 'It\'s already in effect.'
      },
    }),
    remove_channel: defineAsk({
      input: z.object({ id: z.string().max(40) }),
      tool: 'Ask to remove one of your channels.',
      title: async ({ agentId, input }) => `Remove ${LABEL[(await ownChannel({ agentId, id: input.id })).kind]}`,
      run: async ({ actor, ask: { agentId, input: { id } } }) => {
        await ownChannel({ agentId, id }).then(() => channelService.delete({ actor, id })).catch(alreadyDone(404))
        return 'You have already restarted with it.'
      },
    }),
  },
  on: {
    'message.arriving': async ({ agent, event }) => {
      const userId = event.source?.userId
      if (event.source?.platform !== 'telegram' || !userId) return undefined
      const code = INVITE.exec(event.text.trim())?.[1]
      if (!code) return await channelService.telegramMember({ agentId: agent.id, userId }) ? { allow: 'openhut member' } : { skip: 'openhut stranger' }
      const chatId = Number(event.source.chatId)
      if (TELEGRAM_USER.test(userId) && Number.isSafeInteger(chatId)) {
        await channelService.telegramJoin({ agentId: agent.id, code, person: { userId, name: event.source.userName?.slice(0, 100) || 'there', chatId } }).catch(() => undefined)
      }
      return { skip: 'openhut invite' }
    },
  },
})

const LABEL = { slack: 'Slack', whatsapp: 'WhatsApp', telegram: 'Telegram', discord: 'Discord' } as const

function newChannel({ agentId, input }: { agentId: string; input: object }) {
  const parsed = mini.safeParse(CreateChannel, { ...input, agentId })
  if (!parsed.success) throw new HttpError(400, `That channel isn't valid. ${describeIssues(parsed.error.issues)}`)
  return parsed.data
}

async function ownChannel({ agentId, id }: { agentId: string; id: string }): Promise<{ kind: keyof typeof LABEL }> {
  const channel = await db.selectFrom('channel').select('kind').where('id', '=', id).where('agent_id', '=', agentId).executeTakeFirst()
  if (!channel) throw new HttpError(404, `You have no channel ${id}. Call get_self to see yours.`)
  return channel
}

function alreadyDone(status: number) {
  return (err: unknown) => {
    if (!(err instanceof HttpError) || err.status !== status) throw err
  }
}

function partOf({ channel, gateway, token, net }: { channel: RenderedChannel; gateway: string; token: string; net: number }): { config: Record<string, unknown>; env: Record<string, string> } {
  switch (channel.kind) {
    case 'slack': return { config: slack.config, env: slack.env({ token, gateway, channels: channel.audience.allowed }) }
    case 'telegram': return { config: telegram.config({ gateway }), env: telegram.env({ botToken: token, audience: channel.audience }) }
    case 'discord': return {}
    case 'whatsapp': return { config: whatsapp.config({ bridgePort: config.agentHostNet ? WHATSAPP_PORT_BASE + net : undefined }), env: whatsapp.env(channel.audience) }
  }
}
