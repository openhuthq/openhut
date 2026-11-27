import { lazy, Suspense } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel, ChannelKind } from '@openhut/common/channels/channel.ts'
import { useChannels } from '@/features/agents/api'

const SlackDialog = lazy(() => import('@/features/agents/slack-dialog').then((module) => ({ default: module.SlackDialog })))
const TelegramDialog = lazy(() => import('@/features/agents/telegram-dialog').then((module) => ({ default: module.TelegramDialog })))
const DiscordDialog = lazy(() => import('@/features/agents/discord-dialog').then((module) => ({ default: module.DiscordDialog })))
const WhatsappDialog = lazy(() => import('@/features/agents/whatsapp-dialog').then((module) => ({ default: module.WhatsappDialog })))

export function ChannelDialog({ agent, kind, onClose }: { agent: Agent; kind: ChannelKind; onClose: () => void }) {
  const channels = useChannels(agent.id)
  if (!channels.data || !agent.canEdit) return null
  const channel = channels.data.find((each) => each.kind === kind)
  return <Suspense fallback={null}><Kind kind={kind} agent={agent} channel={channel} onClose={onClose} /></Suspense>
}

function Kind({ kind, agent, channel, onClose }: { kind: ChannelKind; agent: Agent; channel: Channel | undefined; onClose: () => void }) {
  if (kind === 'slack') return <SlackDialog agent={agent} channel={channel} onClose={onClose} />
  if (kind === 'discord') return <DiscordDialog agent={agent} channel={channel} onClose={onClose} />
  if (kind === 'whatsapp') return <WhatsappDialog agent={agent} channel={channel} onClose={onClose} />
  return <TelegramDialog agent={agent} channel={channel} onClose={onClose} />
}
