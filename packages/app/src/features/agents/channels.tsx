import type { Agent } from '@openhut/common/agents/agent.ts'
import type { ChannelKind } from '@openhut/common/channels/channel.ts'
import { useChannels } from '@/features/agents/api'
import { SlackDialog } from '@/features/agents/slack-dialog'
import { TelegramDialog } from '@/features/agents/telegram-dialog'
import { DiscordDialog } from '@/features/agents/discord-dialog'
import { WhatsappDialog } from '@/features/agents/whatsapp-dialog'

export function ChannelDialog({ agent, kind, onClose }: { agent: Agent; kind: ChannelKind; onClose: () => void }) {
  const channels = useChannels(agent.id)
  if (!channels.data || !agent.canEdit) return null
  const channel = channels.data.find((each) => each.kind === kind)
  if (kind === 'slack') return <SlackDialog agent={agent} channel={channel} onClose={onClose} />
  if (kind === 'discord') return <DiscordDialog agent={agent} channel={channel} onClose={onClose} />
  if (kind === 'whatsapp') return <WhatsappDialog agent={agent} channel={channel} onClose={onClose} />
  return <TelegramDialog agent={agent} channel={channel} onClose={onClose} />
}
