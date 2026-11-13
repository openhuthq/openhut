import * as z from 'zod/mini'
import { Timestamp, atLeastOneField } from '../api.ts'

export const ChannelKind = z.enum(['slack', 'whatsapp'])
export type ChannelKind = z.infer<typeof ChannelKind>

export const ADDRESS = {
  slack: { pattern: /^[UW][A-Z0-9]{6,}$/, message: 'Use a Slack member ID, like U012AB3CD.' },
  whatsapp: { pattern: /^\+?[1-9]\d{6,14}$/, message: 'Use a phone number with its country code, like +15551234567.' },
} as const satisfies Record<ChannelKind, { pattern: RegExp; message: string }>

const SlackId = z.string().check(z.regex(ADDRESS.slack.pattern, ADDRESS.slack.message))
const Phone = z.string().check(z.regex(ADDRESS.whatsapp.pattern, ADDRESS.whatsapp.message))

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
    ownerAddress: SlackId,
    open: z.boolean(),
    allowed: z.array(SlackId).check(z.maxLength(50)),
  }),
  z.object({
    kind: z.literal('whatsapp'),
    agentId: z.string().check(z.maxLength(40)),
    ownerAddress: Phone,
    open: z.boolean(),
    allowed: z.array(Phone).check(z.maxLength(50)),
  }),
])
export type CreateChannel = z.infer<typeof CreateChannel>

export const UpdateChannel = z.object({
  open: z.optional(z.boolean()),
  allowed: z.optional(z.array(z.string().check(z.maxLength(20))).check(z.maxLength(50))),
}).check(atLeastOneField)
export type UpdateChannel = z.infer<typeof UpdateChannel>

export const ListChannels = z.object({ agentId: z.optional(z.string()) })
export type ListChannels = z.infer<typeof ListChannels>
