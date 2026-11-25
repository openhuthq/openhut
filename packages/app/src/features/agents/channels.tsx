import { useState } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel, ChannelKind } from '@openhut/common/channels/channel.ts'
import { PlusSignIcon } from '@hugeicons/core-free-icons'
import { Button, buttonVariants } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { Glyph } from '@/components/glyph'
import { I, ROW, Section } from '@/components/kit'
import { agentPath } from '@/app/routes'
import { useChannels, useDeleteChannel } from '@/features/agents/api'
import { ORDER, listedChannels } from '@/features/agents/channel-kinds'
import { useFeatures } from '@/features/computers/api'
import { SlackDialog } from '@/features/agents/slack-dialog'
import { TelegramDialog } from '@/features/agents/telegram-dialog'
import { DiscordDialog } from '@/features/agents/discord-dialog'
import { WhatsappDialog } from '@/features/agents/whatsapp-dialog'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const KINDS: Record<ChannelKind, { label: string; remove: string; gone: string }> = {
  slack: { label: 'Slack', remove: 'Disconnect', gone: 'stops answering in Slack. Connecting again takes new tokens.' },
  whatsapp: { label: 'WhatsApp', remove: 'Disconnect', gone: 'stops answering on WhatsApp. Connecting again takes a new QR scan.' },
  telegram: { label: 'Telegram', remove: 'Disconnect', gone: 'stops answering on Telegram. Connecting again takes the bot token.' },
  discord: { label: 'Discord', remove: 'Disconnect', gone: 'stops answering in Discord. Connecting again takes the bot token.' },
}

export function ChannelRows({ agent }: { agent: Agent }) {
  const channels = useChannels(agent.id)
  const features = useFeatures()
  const shown = listedChannels(channels.data ?? [])
  const others = ORDER.filter((kind) => (kind !== 'whatsapp' || features.whatsapp) && !shown.some((channel) => channel.kind === kind))
  return <Section title="Channels" action={<AddChannel agent={agent} kinds={others} />}>
    <ErrorNote message={channels.error?.message} />
    {channels.data && !shown.length && <p className="m-0 text-[12px]/[16px] text-balance text-mute">{agent.name} isn't on any channel yet.</p>}
    <div className="-mx-2.5 flex flex-col gap-px">{shown.map((channel) => <ChannelRow key={channel.id} agent={agent} channel={channel} />)}</div>
  </Section>
}

function AddChannel({ agent, kinds }: { agent: Agent; kinds: ChannelKind[] }) {
  return <DropdownMenu>
    <DropdownMenuTrigger className={cn(buttonVariants({ variant: 'text' }), 'text-xs')} disabled={!agent.canEdit || !kinds.length}><I icon={PlusSignIcon} size={12} />Add</DropdownMenuTrigger>
    <DropdownMenuContent align="end">
      {kinds.map((kind) => <DropdownMenuItem size="tall" key={kind} onClick={() => navigate(agentPath({ agentId: agent.id, dialog: kind }))}>
        <Glyph name={kind} size={16} />{KINDS[kind].label}
      </DropdownMenuItem>)}
    </DropdownMenuContent>
  </DropdownMenu>
}

function ChannelRow({ agent, channel }: { agent: Agent; channel: Channel }) {
  const deleteChannel = useDeleteChannel()
  const [confirming, setConfirming] = useState(false)
  const open = () => navigate(agentPath({ agentId: agent.id, dialog: channel.kind }))
  const { label, remove, gone } = KINDS[channel.kind]
  return <div className={cn(ROW, 'cursor-default')} onClick={agent.canEdit && channel.status !== 'connected' ? open : undefined}>
    <Glyph name={channel.kind} size={16} />
    {label}<span className="min-w-0 flex-1 truncate text-xs text-mute">{channel.status === 'linking' ? 'Waiting for scan…' : 'Connected'}</span>
    {channel.status === 'connected'
      ? <Switch checked aria-label={`${remove} ${label}`} disabled={!agent.canEdit || deleteChannel.isPending} onCheckedChange={() => setConfirming(true)} />
      : <Button type="button" variant="secondary" size="xs" className="rounded-full px-2.5 text-[12px] font-normal" disabled={!agent.canEdit} onClick={(event) => { event.stopPropagation(); open() }}>Scan code</Button>}
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} question={`${remove} ${label}?`} detail={`${agent.name} ${gone}`} action={remove}
      onConfirm={() => deleteChannel.mutate(channel, { onError: toastError })} />
  </div>
}

export function ChannelDialog({ agent, kind, onClose }: { agent: Agent; kind: ChannelKind; onClose: () => void }) {
  const channels = useChannels(agent.id)
  if (!channels.data || !agent.canEdit) return null
  const channel = channels.data.find((each) => each.kind === kind)
  if (kind === 'slack') return <SlackDialog agent={agent} channel={channel} onClose={onClose} />
  if (kind === 'discord') return <DiscordDialog agent={agent} channel={channel} onClose={onClose} />
  if (kind === 'whatsapp') return <WhatsappDialog agent={agent} channel={channel} onClose={onClose} />
  return <TelegramDialog agent={agent} channel={channel} onClose={onClose} />
}
