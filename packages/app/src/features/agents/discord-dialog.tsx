import { useState } from 'react'
import { LinkSquare02Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel } from '@openhut/common/channels/channel.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { ErrorNote } from '@/components/error-note'
import { Busy, HINT, I, PILL, SetupSheet, Step } from '@/components/kit'
import { ChannelPicker } from '@/features/agents/channel-picker'
import { useConversations, useCreateChannel, useUpdateChannel } from '@/features/agents/api'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { cn } from '@/lib/utils'

export function DiscordDialog({ agent, channel, onClose }: { agent: Agent; channel: Channel | undefined; onClose: () => void }) {
  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()
  const conversations = useConversations(channel, { waiting: !!channel && !channel.allowed.length })
  const [picked, setPicked] = useState<string[] | undefined>(undefined)
  const chosen = picked ?? channel?.allowed ?? []
  const live = !!channel && channel.allowed.length > 0
  const joined = (conversations.data?.length ?? 0) > 0
  const servers = [...new Set((conversations.data ?? []).map((each) => each.group ?? ''))]
  const changed = !!channel && (chosen.length !== channel.allowed.length || chosen.some((id) => !channel.allowed.includes(id)))
  const save = () => channel && updateChannel.mutate({ channel, change: { allowed: chosen } }, { onSuccess: () => setPicked(undefined) })
  const foot = !channel
    ? createChannel.isPending ? <Busy label="Checking with Discord…" /> : <><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="discord-main" variant="primary">Next</Button></>
    : updateChannel.isPending ? <Busy label="Connecting…" />
    : changed && chosen.length ? <><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="button" variant="primary" onClick={save}>{live ? 'Save' : 'Connect'}</Button></>
    : <Button type="button" variant={live ? 'primary' : 'secondary'} onClick={onClose}>{live ? 'Done' : 'Close'}</Button>
  return <SetupSheet brand="discord" title={live ? `${agent.name} on Discord` : `Connect ${agent.name} to Discord`} blurb={live ? `${channel.account ?? 'Its bot'} answers in ${channel.allowed.length === 1 ? 'one channel' : `${channel.allowed.length} channels`} when someone mentions it.` : `${agent.name} gets its own Discord bot.`}
    eta={channel ? undefined : '2 minutes'} safe="Only people in its channels can talk to it." error={formError(createChannel.error ?? updateChannel.error, ['botToken', 'allowed'])} foot={foot} onClose={onClose}>
    <form id="discord-main" className="contents" onSubmit={(event) => {
      const field = formValues(event)
      createChannel.mutate({ kind: 'discord', agentId: agent.id, botToken: field('botToken'), allowed: [] })
    }}>
      <Step n={1} title="Make the bot" state={channel ? 'done' : 'now'} tag={channel?.account ?? undefined}>
        {!channel && <>
          <div><a className={cn(buttonVariants({ variant: 'secondary' }), PILL)} href="https://discord.com/developers/applications" target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={12} />Open Discord</a></div>
          <p className={HINT}>In Discord: <b>New Application</b>, call it {agent.name}. On <b>Bot</b>, turn <b>Public Bot</b> off and <b>Message Content Intent</b> on, then <b>Reset Token</b>.</p>
          <Field label={<span className="text-xs font-medium text-mute">Then paste the token here</span>} error={fieldError(createChannel.error, 'botToken')}>{(control) =>
            <Input {...control} mono name="botToken" required pattern="[\w\-]{20,}\.[\w\-]{4,}\.[\w\-]{20,}" title="Paste the bot token from the Bot page." placeholder="Paste the token" autoComplete="off" />}</Field>
        </>}
      </Step>
      <Step n={2} title="Add it to your server" state={joined ? 'done' : channel ? 'now' : 'next'} tag={joined ? servers.filter(Boolean).join(', ') : undefined}>
        {channel && !joined && <>
          {channel.link && <div><a className={cn(buttonVariants({ variant: 'secondary' }), PILL)} href={channel.link} target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={12} />Add {agent.name} to a server</a></div>}
          <p className={HINT}>Discord opens with the right permissions already ticked. Pick the server, then <b>Authorize</b>.</p>
          <span className="inline-flex items-center gap-2 text-[12px] text-mute"><Spinner className="mt-0 size-3" />Waiting for {agent.name} to join…</span>
          <ErrorNote message={conversations.error?.message} />
        </>}
        {live && channel.link && <a className="w-fit text-[12px] text-mute" href={channel.link} target="_blank" rel="noreferrer">Add it to another server</a>}
      </Step>
    </form>
    <Step n={3} title="Pick its channels" state={joined ? 'now' : 'next'}>
      {joined && <ChannelPicker label="Discord channels" conversations={conversations.data ?? []} loading={conversations.isPending} value={chosen} onChange={setPicked}
        onOpenChange={(open) => { if (open) void conversations.refetch() }}
        note={(each) => servers.length > 1 && <span className="text-xs text-mute">{each.group}</span>}
        blocked={(each) => !each.joined ? `Add ${channel?.account ?? 'its bot'} in the channel’s settings › Permissions.` : undefined} />}
      {joined && <p className={HINT}>Private channels need {channel?.account ?? 'its bot'} added in Discord first.</p>}
    </Step>
  </SetupSheet>
}
