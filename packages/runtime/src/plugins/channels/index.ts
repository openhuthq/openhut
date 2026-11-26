import * as z from 'zod'
import type { Audience, ChannelKind } from '@openhut/common/channels/channel.ts'
import { definePlugin, type HermesPart } from '../../core/plugin.ts'
import { config } from '../../server/platform/config.ts'
import { WHATSAPP_PORT_BASE } from '../../agentd/sandbox/sandbox.ts'
import { slack } from '../../server/integrations/slack/slack.ts'
import { telegram } from '../../server/integrations/telegram/telegram.ts'
import { discord } from '../../server/integrations/discord/discord.ts'
import { whatsapp } from '../../server/integrations/whatsapp/whatsapp.ts'
import { channelService } from '../../server/channels/channel-service.ts'
import { changeTool } from '../asks/change.ts'
import { channelController } from '../../server/channels/channel-controller.ts'
import { log } from '../../server/platform/events.ts'
import { messageOf } from '../../server/platform/http-error.ts'
import { createTables } from './tables.ts'

const INVITE = /^\/start(?:@\w+)?\s+([\w-]{16,64})$/
const TELEGRAM_USER = /^[1-9]\d{4,14}$/
const Dispatched = z.object({
  event: z.object({
    text: z.string(),
    source: z.object({ platform: z.string(), user_id: z.coerce.string().nullish(), user_name: z.string().nullish(), chat_id: z.coerce.string().nullish() }).nullish(),
  }),
})

export type RenderedChannel =
  | { kind: Extract<ChannelKind, 'slack'>; audience: Audience }
  | { kind: Extract<ChannelKind, 'telegram'>; audience: Audience }
  | { kind: Extract<ChannelKind, 'discord'>; audience: Audience; botToken: string }
  | { kind: Extract<ChannelKind, 'whatsapp'>; audience: Audience }

export const channels = definePlugin({
  name: 'channels',
  migrate: createTables,
  routes: () => ({ '/api/channels': channelController }),
  start: () => void channelService.resumeTelegramClaims().catch((err: unknown) => log.warn({ event: 'telegram.claim_resume_failed', error: messageOf(err) })),
  hermes: ({ agent, channels: list, gateway, token }) => {
    const parts = list.map((channel) => partOf({ channel, gateway, token, net: agent.net }))
    return { config: Object.assign({}, ...parts.map((part) => part.config)), env: Object.assign({}, ...parts.map((part) => part.env)) }
  },
  tools: {
    add_channel: changeTool({
      action: 'add_channel',
      description: 'Ask to add WhatsApp, Telegram or Discord, so people can message you there. Slack needs a Slack app, so your owner adds it in OpenHut.',
      input: {
        kind: z.enum(['whatsapp', 'telegram', 'discord']),
        ownerAddress: z.string().max(40).optional().describe('WhatsApp and Telegram: your owner\'s WhatsApp number with country code (+15551234567), or their numeric Telegram user ID.'),
        open: z.boolean().optional().describe('WhatsApp and Telegram: true lets anyone message you; false only your owner and allowed.'),
        allowed: z.array(z.string().max(40)).max(50).default([]).describe('Other numbers or Telegram IDs that may message you. For Discord: the channel IDs to answer in.'),
        botToken: z.string().max(200).optional().describe('For Telegram: the token BotFather gave, like 123456789:AAE…. For Discord: the bot token from the Developer Portal\'s Bot page.'),
      },
    }),
    update_channel: changeTool({ action: 'update_channel', description: 'Ask to change who can message you on one of your channels.', input: { id: z.string().max(40), open: z.boolean().optional(), allowed: z.array(z.string().max(20)).max(50).optional().describe('The whole new list.') } }),
    remove_channel: changeTool({ action: 'remove_channel', description: 'Ask to remove one of your channels.', input: { id: z.string().max(40) } }),
  },
  hooks: {
    pre_gateway_dispatch: async ({ agent, args }) => {
      const event = Dispatched.safeParse(args).data?.event
      const userId = event?.source?.user_id
      if (event?.source?.platform !== 'telegram' || !userId) return undefined
      const code = INVITE.exec(event.text.trim())?.[1]
      if (!code) return await channelService.telegramStranger({ agentId: agent.id, userId }) ? { action: 'skip', reason: 'openhut stranger' } : undefined
      const chatId = Number(event.source?.chat_id)
      if (TELEGRAM_USER.test(userId) && Number.isSafeInteger(chatId)) {
        await channelService.telegramJoin({ agentId: agent.id, code, person: { userId, name: event.source?.user_name?.slice(0, 100) || 'there', chatId } }).catch(() => undefined)
      }
      return { action: 'skip', reason: 'openhut invite' }
    },
  },
})

function partOf({ channel, gateway, token, net }: { channel: RenderedChannel; gateway: string; token: string; net: number }): HermesPart {
  switch (channel.kind) {
    case 'slack': return { config: slack.config, env: slack.env({ token, gateway, channels: channel.audience.allowed }) }
    case 'telegram': return { config: telegram.config({ gateway }), env: telegram.env({ botToken: token, audience: channel.audience }) }
    case 'discord': return { config: discord.config, env: discord.env({ botToken: channel.botToken, channels: channel.audience.allowed }) }
    case 'whatsapp': return { config: whatsapp.config({ bridgePort: config.agentHostNet ? WHATSAPP_PORT_BASE + net : undefined }), env: whatsapp.env(channel.audience) }
  }
}
