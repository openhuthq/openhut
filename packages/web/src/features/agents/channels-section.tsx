import type { Agent } from '@jakebox/common/agents/agent.ts'
import type { Channel, ChannelKind } from '@jakebox/common/channels/channel.ts'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { Locked } from '@/components/locked'
import { Mark } from '@/components/mark'
import { SectionHead } from '@/components/section-head'
import type { AgentDialog } from '@/features/agents/agent-page'
import { useChannels, useDeleteChannel } from '@/features/agents/api'
import { SlackDialog } from '@/features/agents/slack-dialog'
import { WhatsappDialog } from '@/features/agents/whatsapp-dialog'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

const KINDS: Record<ChannelKind, { label: string; idle: string; remove: string }> = {
  slack: { label: 'Slack', idle: 'Its own Slack app, from our manifest', remove: 'Disconnect' },
  whatsapp: { label: 'WhatsApp', idle: 'Its own number, linked by QR code', remove: 'Unlink' },
}

export function ChannelsSection({ agent, lockReason, dialog }: { agent: Agent; lockReason: string | undefined; dialog: AgentDialog | undefined }) {
  const channels = useChannels(agent.id)
  const slack = channels.data?.find((channel) => channel.kind === 'slack')
  const whatsapp = channels.data?.find((channel) => channel.kind === 'whatsapp')
  return <section>
    <SectionHead title="Channels" />
    <ErrorNote message={channels.error?.message} />
    {channels.data && <div className="box rows">
      <ChannelRow kind="slack" agent={agent} channel={slack} lockReason={lockReason} />
      <ChannelRow kind="whatsapp" agent={agent} channel={whatsapp} lockReason={lockReason} />
    </div>}
    {channels.data && agent.canEdit && dialog === 'slack' && <SlackDialog agent={agent} channel={slack} />}
    {channels.data && agent.canEdit && dialog === 'whatsapp' && <WhatsappDialog agent={agent} channel={whatsapp} />}
  </section>
}

function ChannelRow({ kind, agent, channel, lockReason }: { kind: ChannelKind; agent: Agent; channel: Channel | undefined; lockReason: string | undefined }) {
  return <div className="row">
    <Mark name={kind} size={24} />
    <div className="t"><div>{KINDS[kind].label}</div><div className="mute ellip">{channelLine(kind, channel)}</div></div>
    <ChannelActions kind={kind} agent={agent} channel={channel} lockReason={lockReason} />
  </div>
}

function ChannelActions({ kind, agent, channel, lockReason }: { kind: ChannelKind; agent: Agent; channel: Channel | undefined; lockReason: string | undefined }) {
  const deleteChannel = useDeleteChannel()
  const disabled = !agent.canEdit || deleteChannel.isPending
  const open = <Locked reason={lockReason}><button type="button" className="btn sec sm" disabled={disabled} onClick={() => navigate(`/agents/${agent.id}/${kind}`)}>{actionLabel(channel)}</button></Locked>
  if (!channel) return open
  if (channel.status === 'linking') return <>{open}<Locked reason={lockReason}><button type="button" className="btn sec sm" disabled={disabled} onClick={() => deleteChannel.mutate(channel, { onError: toastError })}>Cancel</button></Locked></>
  const { label, remove } = KINDS[kind]
  return <>{open}<Locked reason={lockReason}>
    <ConfirmButton className="btn danger sm" disabled={disabled} question={`${remove} ${label}?`} detail={removalDetail(kind, agent, channel)} action={remove} onConfirm={() => deleteChannel.mutate(channel, { onError: toastError })}>{remove}</ConfirmButton>
  </Locked></>
}

function channelLine(kind: ChannelKind, channel: Channel | undefined) {
  if (!channel) return KINDS[kind].idle
  if (channel.status === 'linking') return 'Waiting for the QR code scan'
  return channel.account ?? 'Connected'
}

function actionLabel(channel: Channel | undefined) {
  if (!channel) return 'Set up'
  if (channel.status === 'linking') return 'Link'
  return 'Edit'
}

function removalDetail(kind: ChannelKind, agent: Agent, channel: Channel) {
  if (kind === 'slack') return `${agent.name} stops answering in Slack. Connecting again takes new tokens.`
  return `${agent.name} stops answering on ${channel.account ?? 'WhatsApp'}. Linking again takes a new QR scan.`
}
