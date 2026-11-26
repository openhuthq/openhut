import type { Audience, ChannelKind } from '@openhut/common/channels/channel.ts'
import { definePlugin, type HermesPart } from '../../core/plugin.ts'
import { config } from '../../server/platform/config.ts'
import { WHATSAPP_PORT_BASE } from '../../agentd/sandbox/sandbox.ts'
import { slack } from '../../server/integrations/slack/slack.ts'
import { telegram } from '../../server/integrations/telegram/telegram.ts'
import { discord } from '../../server/integrations/discord/discord.ts'
import { whatsapp } from '../../server/integrations/whatsapp/whatsapp.ts'

export type RenderedChannel =
  | { kind: Extract<ChannelKind, 'slack'>; audience: Audience }
  | { kind: Extract<ChannelKind, 'telegram'>; audience: Audience }
  | { kind: Extract<ChannelKind, 'discord'>; audience: Audience; botToken: string }
  | { kind: Extract<ChannelKind, 'whatsapp'>; audience: Audience }

export const channels = definePlugin({
  name: 'channels',
  hermes: ({ agent, channels: list, gateway, token }) => {
    const parts = list.map((channel) => partOf({ channel, gateway, token, net: agent.net }))
    return { config: Object.assign({}, ...parts.map((part) => part.config)), env: Object.assign({}, ...parts.map((part) => part.env)) }
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
