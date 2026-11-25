import type { Channel, ChannelKind } from '@openhut/common/channels/channel.ts'

export const ORDER: ChannelKind[] = ['slack', 'discord', 'whatsapp', 'telegram']

export function listedChannels(channels: Channel[]): Channel[] {
  return ORDER.flatMap((kind) => channels.filter((channel) => channel.kind === kind))
}
