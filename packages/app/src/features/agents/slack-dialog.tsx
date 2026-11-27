import { useEffect, useState, type ClipboardEvent } from 'react'
import { LinkSquare02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel } from '@openhut/common/channels/channel.ts'
import { slackCreateUrl, slackManifest } from './slack-manifest'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CopyButton } from '@/components/copy-button'
import { Busy, HINT, I, PILL, SetupSheet, Step } from '@/components/kit'
import { useConversations, useCreateChannel } from '@/features/agents/api'
import { slackIcon } from '@/components/agent-face'
import { SlackChannels } from '@/features/agents/slack-channels'
import { formError } from '@/lib/api-client'
import { cn } from '@/lib/utils'

const TOKENS = [
  { key: 'appToken', prefix: 'xapp-', label: 'App token', where: 'Basic Information › App-Level Tokens' },
  { key: 'botToken', prefix: 'xoxb-', label: 'Bot token', where: 'Install App › Bot User OAuth Token' },
] as const
type Tokens = Partial<Record<(typeof TOKENS)[number]['key'], string>>

export function SlackDialog({ agent, channel, onClose }: { agent: Agent; channel: Channel | undefined; onClose: () => void }) {
  const createChannel = useCreateChannel()
  const [opened, setOpened] = useState(false)
  const [tokens, setTokens] = useState<Tokens>({})
  const [wrong, setWrong] = useState(false)
  const live = !!channel && channel.allowed.length > 0
  useEffect(() => {
    if (channel || !createChannel.isIdle || !tokens.appToken || !tokens.botToken) return
    createChannel.mutate({ kind: 'slack', agentId: agent.id, appToken: tokens.appToken, botToken: tokens.botToken })
  }, [agent.id, channel, createChannel, tokens])
  const take = (raw: string) => {
    const token = raw.trim()
    const kind = TOKENS.find((each) => token.startsWith(each.prefix))
    setWrong(!kind && token.length > 0)
    if (!kind) return
    createChannel.reset()
    setTokens((now) => ({ ...now, [kind.key]: token }))
  }
  const foot = live || channel
    ? <Button type="button" variant={live ? 'primary' : 'secondary'} onClick={onClose}>{live ? 'Done' : 'Close'}</Button>
    : createChannel.isPending ? <Busy label="Checking with Slack…" /> : <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
  return <SetupSheet brand="slack" title={channel ? `${agent.name} on Slack` : `Connect ${agent.name} to Slack`} blurb={live ? `${channel.account ?? 'Its app'} is live.` : `${agent.name} gets its own Slack app.`} eta={channel ? undefined : '3 minutes'}
    safe="Only people in its channels can talk to it." error={formError(createChannel.error, [])} foot={foot} onClose={onClose}>
    <Step n={1} title="Create the Slack app" state={channel || opened ? 'done' : 'now'}>
      {!channel && !opened && <>
        <div className="flex flex-wrap gap-1.5">
          <a className={cn(buttonVariants({ variant: 'secondary' }), PILL)} href={slackCreateUrl(agent.name)} target="_blank" rel="noreferrer" onClick={() => setOpened(true)}><I icon={LinkSquare02Icon} size={12} />Create the Slack app</a>
          <CopyButton text={JSON.stringify(slackManifest(agent.name), null, 2)} label="Copy manifest" className={PILL} />
        </div>
        <p className={HINT}>Slack opens with {agent.name}’s name and settings filled in. Pick your workspace, then <b>Create</b>.</p>
        <Button type="button" variant="text" className="w-fit text-[12px] font-normal text-mute" onClick={() => setOpened(true)}>I already made it</Button>
      </>}
    </Step>
    <Step n={2} title="Paste two tokens" state={channel ? 'done' : opened ? 'now' : 'next'} tag={channel?.account ?? undefined}>
      {!channel && opened && <>
        <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-mute">Paste each token here. OpenHut works out which is which.</span>
          <Input mono value="" placeholder="Paste a token" autoComplete="off" aria-invalid={wrong || undefined} disabled={createChannel.isPending}
            onChange={(event) => take(event.target.value)} onPaste={(event: ClipboardEvent<HTMLInputElement>) => { event.preventDefault(); take(event.clipboardData.getData('text')) }} /></label>
        {wrong && <p className="m-0 text-[12px] text-fail">That isn’t a Slack app or bot token. App tokens start with xapp-, bot tokens with xoxb-.</p>}
        <div className="flex flex-col gap-1.5">{TOKENS.map((each) => <div key={each.key} className="flex items-center gap-2 text-[13px]">
          {tokens[each.key] ? <I icon={Tick02Icon} size={14} className="text-pass" /> : <span className="size-3.5 rounded-[4px] border-[1.5px] border-mute-2" />}
          <span className="shrink-0 whitespace-nowrap">{each.label}</span>
          <span className="ml-auto truncate pl-3 font-mono text-[11.5px] text-mute">{tokens[each.key] ? `${each.prefix}…${tokens[each.key]?.slice(-4)}` : each.where}</span>
        </div>)}</div>
      </>}
    </Step>
    <Step n={3} title="Pick its channels" state={live ? 'done' : channel ? 'now' : 'next'} tag={live ? `${channel.allowed.length} picked` : undefined}>
      {channel && <><SlackChannels key={channel.allowed.join()} agent={agent} channel={channel} /><SharedNote agent={agent} channel={channel} /></>}
    </Step>
    {live && <FaceNote agent={agent} />}
  </SetupSheet>
}

function SharedNote({ agent, channel }: { agent: Agent; channel: Channel }) {
  const shared = (useConversations(channel).data ?? []).filter((each) => each.shared && channel.allowed.includes(each.id))
  if (!shared.length) return null
  return <p className="m-0 rounded-lg bg-warning-subtle px-3 py-2 text-[12px]/[16px] text-warning-foreground">{shared.map((each) => `#${each.name}`).join(', ')} {shared.length === 1 ? 'includes' : 'include'} people outside your workspace. They could ask {agent.name} to use everything it has access to.</p>
}

function FaceNote({ agent }: { agent: Agent }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => { void slackIcon(agent).then((png) => setSrc(`data:image/png;base64,${png}`)) }, [agent])
  return <div className="flex items-center gap-3 rounded-lg bg-soft px-3 py-2.5 text-[12px]/[16px] text-body">
    {src && <img src={src} alt={`${agent.name}’s picture`} width={36} height={36} draggable className="shrink-0 cursor-grab rounded-lg" />}
    <span><b className="font-medium text-ink">Optional:</b> give it its face. Drag this picture onto <b className="font-medium text-ink">Basic Information › App icon</b> in Slack.</span>
  </div>
}
