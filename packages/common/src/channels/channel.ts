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

export function slackManifest(name: string) {
  const display = name.slice(0, 35)
  return {
    _metadata: { major_version: 1, minor_version: 1 },
    display_information: { name: display, description: `${display}, a JakeBox agent`.slice(0, 140), background_color: '#1a1a2e' },
    features: {
      app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
      bot_user: { display_name: display, always_online: true },
      assistant_view: { assistant_description: `Chat with ${display} in threads and DMs.` },
    },
    oauth_config: {
      scopes: {
        bot: ['app_mentions:read', 'assistant:write', 'channels:history', 'channels:read', 'chat:write', 'files:read', 'files:write', 'groups:history', 'groups:read',
          'im:history', 'im:read', 'im:write', 'mpim:history', 'mpim:read', 'reactions:read', 'users:read'],
      },
    },
    settings: {
      event_subscriptions: {
        bot_events: ['app_mention', 'assistant_thread_context_changed', 'assistant_thread_started', 'message.channels', 'message.groups', 'message.im', 'message.mpim',
          'reaction_added', 'reaction_removed'],
      },
      interactivity: { is_enabled: true },
      org_deploy_enabled: false,
      socket_mode_enabled: true,
      token_rotation_enabled: false,
    },
  }
}

export const slackCreateUrl = (name: string) => `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(slackManifest(name)))}`
