import { useState } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel, ChannelKind } from '@openhut/common/channels/channel.ts'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { ROW, Section } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { useChannels, useDeleteChannel } from '@/features/agents/api'
import { SlackDialog } from '@/features/agents/slack-dialog'
import { TelegramDialog } from '@/features/agents/telegram-dialog'
import { WhatsappDialog } from '@/features/agents/whatsapp-dialog'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const KINDS: Record<ChannelKind, { label: string; remove: string; gone: string }> = {
  slack: { label: 'Slack', remove: 'Disconnect', gone: 'stops answering in Slack. Connecting again takes new tokens.' },
  whatsapp: { label: 'WhatsApp', remove: 'Unlink', gone: 'stops answering on WhatsApp. Linking again takes a new QR scan.' },
  telegram: { label: 'Telegram', remove: 'Disconnect', gone: 'stops answering on Telegram. Connecting again takes the bot token.' },
}
const ORDER: ChannelKind[] = ['slack', 'whatsapp', 'telegram']

export function ChannelRows({ agent }: { agent: Agent }) {
  const channels = useChannels(agent.id)
  return <Section title="Talk to it on">
    <ErrorNote message={channels.error?.message} />
    <div className="-mx-2.5 flex flex-col gap-px">{ORDER.map((kind) => <ChannelRow key={kind} agent={agent} kind={kind} channel={channels.data?.find((channel) => channel.kind === kind)} />)}</div>
  </Section>
}

function ChannelRow({ agent, kind, channel }: { agent: Agent; kind: ChannelKind; channel: Channel | undefined }) {
  const deleteChannel = useDeleteChannel()
  const [confirming, setConfirming] = useState(false)
  const open = () => navigate(agentPath({ agentId: agent.id, dialog: kind }))
  const { label, remove, gone } = KINDS[kind]
  return <div className={cn(ROW, 'cursor-default')} onClick={agent.canEdit && channel?.status !== 'connected' ? open : undefined}>
    <Glyph name={kind} size={16} />
    {label}<span className="min-w-0 flex-1 truncate text-xs text-mute">{line(channel)}</span>
    {channel?.status === 'connected'
      ? <Switch checked aria-label={`${remove} ${label}`} disabled={!agent.canEdit || deleteChannel.isPending} onCheckedChange={() => setConfirming(true)} />
      : <Button type="button" variant="secondary" size="xs" className="rounded-full px-2.5 text-[12px] font-normal" disabled={!agent.canEdit} onClick={(event) => { event.stopPropagation(); open() }}>{channel ? 'Link' : 'Set up'}</Button>}
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} question={`${remove} ${label}?`} detail={`${agent.name} ${gone}`} action={remove}
      onConfirm={() => channel && deleteChannel.mutate(channel, { onError: toastError })} />
  </div>
}

function line(channel: Channel | undefined) {
  if (!channel) return ''
  if (channel.status === 'linking') return 'Waiting for the scan'
  return 'Connected'
}

export function ChannelDialog({ agent, kind, onClose }: { agent: Agent; kind: ChannelKind; onClose: () => void }) {
  const channels = useChannels(agent.id)
  if (!channels.data || !agent.canEdit) return null
  const channel = channels.data.find((each) => each.kind === kind)
  if (kind === 'slack') return <SlackDialog agent={agent} channel={channel} onClose={onClose} />
  if (kind === 'whatsapp') return <WhatsappDialog agent={agent} channel={channel} onClose={onClose} />
  return <TelegramDialog agent={agent} channel={channel} onClose={onClose} />
}
