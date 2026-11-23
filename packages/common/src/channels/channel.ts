import * as z from 'zod/mini'
import { Timestamp, atLeastOneField } from '../api.ts'

export const ChannelKind = z.enum(['slack', 'whatsapp', 'telegram', 'discord'])
export type ChannelKind = z.infer<typeof ChannelKind>

export const ADDRESS = {
  slack: { pattern: /^[CG][A-Z0-9]{6,}$/, message: 'Pick Slack channels from the list.' },
  whatsapp: { pattern: /^\+?[1-9]\d{6,14}$/, message: 'Use a phone number with its country code, like +15551234567.' },
  telegram: { pattern: /^[1-9]\d{4,14}$/, message: 'Use a Telegram user ID, like 123456789. @userinfobot tells you yours.' },
  discord: { pattern: /^[1-9]\d{16,19}$/, message: 'Use a Discord channel ID, like 1234567890123456789. Right-click the channel and Copy Channel ID.' },
} as const satisfies Record<ChannelKind, { pattern: RegExp; message: string }>

const Phone = z.string().check(z.regex(ADDRESS.whatsapp.pattern, ADDRESS.whatsapp.message))
const TelegramId = z.string().check(z.regex(ADDRESS.telegram.pattern, ADDRESS.telegram.message))
const DiscordChannelId = z.string().check(z.regex(ADDRESS.discord.pattern, ADDRESS.discord.message))

export const Channel = z.object({
  id: z.string(),
  object: z.literal('channel'),
  agentId: z.string(),
  kind: ChannelKind,
  status: z.enum(['connected', 'linking']),
  account: z.nullable(z.string()),
  ownerAddress: z.string(),
  open: z.boolean(),
  allowed: z.array(z.string()),
  names: z.optional(z.record(z.string(), z.string())),
  qr: z.nullable(z.string()),
  createdAt: Timestamp,
})
export type Channel = z.infer<typeof Channel>

export type Audience = Pick<Channel, 'ownerAddress' | 'open' | 'allowed'>

export const CreateChannel = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('slack'),
    agentId: z.string().check(z.maxLength(40)),
    botToken: z.string().check(z.regex(/^xoxb-[\w-]{10,}$/, 'Paste the bot token: it starts with xoxb-.')),
    appToken: z.string().check(z.regex(/^xapp-[\w-]{10,}$/, 'Paste the app-level token: it starts with xapp-.')),
    configToken: z.string().check(z.regex(/^xoxe\.xoxp-[\w.-]{10,}$/, 'Paste the app configuration token: it starts with xoxe.xoxp-.')),
    icon: z.string().check(z.maxLength(1_000_000), z.regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Send the icon as a base64 PNG.')),
  }),
  z.object({
    kind: z.literal('whatsapp'),
    agentId: z.string().check(z.maxLength(40)),
    ownerAddress: Phone,
    open: z.boolean(),
    allowed: z.array(Phone).check(z.maxLength(50)),
  }),
  z.object({
    kind: z.literal('telegram'),
    agentId: z.string().check(z.maxLength(40)),
    botToken: z.string().check(z.regex(/^\d{6,}:[\w-]{30,}$/, 'Paste the token BotFather gave you, like 123456789:AAE….')),
    ownerAddress: z.optional(TelegramId),
    open: z._default(z.boolean(), false),
    allowed: z._default(z.array(TelegramId).check(z.maxLength(50)), []),
  }),
  z.object({
    kind: z.literal('discord'),
    agentId: z.string().check(z.maxLength(40)),
    botToken: z.string().check(z.regex(/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/, 'Paste the bot token from the Developer Portal\'s Bot page.')),
    allowed: z.array(DiscordChannelId).check(z.minLength(1, 'Add at least one channel ID.'), z.maxLength(50)),
  }),
])
export type CreateChannel = z.infer<typeof CreateChannel>

export const UpdateChannel = z.object({
  open: z.optional(z.boolean()),
  allowed: z.optional(z.array(z.string().check(z.maxLength(20))).check(z.maxLength(50))),
}).check(atLeastOneField)
export type UpdateChannel = z.infer<typeof UpdateChannel>

export const Conversation = z.object({
  id: z.string(),
  object: z.literal('conversation'),
  name: z.string(),
  type: z.enum(['public', 'private', 'group']),
  shared: z.boolean(),
  members: z.number(),
  joined: z.boolean(),
})
export type Conversation = z.infer<typeof Conversation>

export const ListChannels = z.object({ agentId: z.optional(z.string()) })
export type ListChannels = z.infer<typeof ListChannels>

export const ChannelRecord = z.object({
  kind: ChannelKind,
  status: z.enum(['connected', 'linking']),
  account: z.nullable(z.string()),
  ownerAddress: z.string(),
  open: z.boolean(),
  allowed: z.array(z.string()),
  names: z.optional(z.record(z.string(), z.string())),
  createdAt: z.string(),
})
export type ChannelRecord = z.infer<typeof ChannelRecord>

export const ChannelSecrets = z.object({ botToken: z.optional(z.string()), appToken: z.optional(z.string()) })
export type ChannelSecrets = z.infer<typeof ChannelSecrets>

export const TelegramInvite = z.object({ object: z.literal('telegram_invite'), url: z.string(), expiresAt: Timestamp })
export type TelegramInvite = z.infer<typeof TelegramInvite>
