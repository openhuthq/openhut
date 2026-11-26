import { useRef, useState } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel } from '@openhut/common/channels/channel.ts'
import { Badge } from '@/components/ui/badge'
import { ErrorNote } from '@/components/error-note'
import { ChannelPicker } from '@/features/agents/channel-picker'
import { useConversations, useUpdateChannel } from '@/features/agents/api'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function SlackChannels({ agent, channel, inset = false }: { agent: Agent; channel: Channel; inset?: boolean }) {
  const conversations = useConversations(channel)
  const updateChannel = useUpdateChannel()
  const [picked, setPicked] = useState(channel.allowed)
  const latest = useRef(picked)
  const isOpen = useRef(false)
  const bot = channel.account?.split('@')[1] ?? agent.name
  const disabled = !agent.canEdit || updateChannel.isPending
  const pick = (next: string[]) => {
    latest.current = next
    setPicked(next)
  }
  const save = () => {
    const next = latest.current
    if (next.length === channel.allowed.length && next.every((id) => channel.allowed.includes(id))) return
    updateChannel.mutate({ channel, change: { allowed: next } }, { onError: (err) => { pick(channel.allowed); toastError(err) } })
  }
  return <div className={cn('flex min-w-0 flex-col gap-2', inset && 'pr-3 pb-3 pl-[46px]')}>
    <ChannelPicker label="Slack channels" conversations={conversations.data ?? []} loading={conversations.isPending} value={picked} disabled={disabled}
      onChange={(next) => { pick(next); if (!isOpen.current) save() }}
      onOpenChange={(open) => { isOpen.current = open; if (!open) save() }}
      note={(each) => <>{each.shared && <Badge variant="count" title="Shared with people outside this workspace">shared</Badge>}<span className="font-mono text-xs text-mute">{each.members}</span></>}
      footer={<>Private channels and group DMs show up here once @{bot} is in them: type /invite @{bot} there.</>} />
    <ErrorNote message={conversations.error?.message} />
  </div>
}
