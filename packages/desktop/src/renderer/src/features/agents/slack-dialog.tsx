import { LinkSquare02Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel } from '@openhut/common/channels/channel.ts'
import { slackCreateUrl, slackManifest } from './slack-manifest'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { avatarPng } from '@/components/creature'
import { CopyButton } from '@/components/copy-button'
import { Busy, HINT, I, SetupSheet, Step } from '@/components/kit'
import { useCreateChannel } from '@/features/agents/api'
import { lookOf } from '@/features/agents/face'
import { SlackChannels } from '@/features/agents/slack-channels'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { toastError } from '@/lib/toast'

const FIELDS = ['botToken', 'appToken', 'configToken']

export function SlackDialog({ agent, channel, onClose }: { agent: Agent; channel: Channel | undefined; onClose: () => void }) {
  const createChannel = useCreateChannel()
  const manifest = JSON.stringify(slackManifest(agent.name), null, 2)
  const foot = channel
    ? <Button type="button" variant="primary" onClick={onClose}>Done</Button>
    : createChannel.isPending ? <Busy label="Checking with Slack…" /> : <><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="slack-main" variant="primary">Connect</Button></>
  return <SetupSheet brand="slack" title={`Connect ${agent.name} to Slack`} blurb={`${agent.name} gets its own Slack app, with its face, and answers in the channels you pick.`} eta="4 minutes"
    safe="Only people in the channels you pick can talk to it. Tokens are sealed on this server." error={formError(createChannel.error, FIELDS)} foot={foot} onClose={onClose}>
    <form id="slack-main" className="contents" onSubmit={(event) => {
      const field = formValues(event)
      if (channel) return
      avatarPng(lookOf(agent))
        .then((icon) => createChannel.mutate({ kind: 'slack', agentId: agent.id, botToken: field('botToken'), appToken: field('appToken'), configToken: field('configToken'), icon }))
        .catch(toastError)
    }}>
      <Step n={1} title="Create the app" state={channel ? 'done' : 'now'} tag="manifest filled in">
        {!channel && <>
          <div className="flex flex-wrap gap-1.5">
            <a className={buttonVariants({ variant: 'secondary', size: 'sm' })} href={slackCreateUrl(agent.name)} target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={14} />Create the Slack app</a>
            <CopyButton text={manifest} label="Copy manifest" />
          </div>
          <p className={HINT}>Slack opens with the name, scopes and Socket Mode filled in. Pick your workspace, then <b>Create</b>.</p>
        </>}
      </Step>
      <Step n={2} title="Paste its three tokens" state={channel ? 'done' : 'now'} tag={channel?.account ?? undefined}>
        {!channel && <>
          <Field label={<span className="text-xs font-medium text-mute">App token</span>} error={fieldError(createChannel.error, 'appToken')}
            hint={<span className={HINT}><b>Basic Information</b> › <b>App-Level Tokens</b> › <b>Generate Token and Scopes</b>. Add the <code>connections:write</code> scope, then copy the token.</span>}>{(control) =>
            <Input {...control} mono name="appToken" required pattern="xapp-[\w\-]{10,}" title="Paste the app-level token. It starts with xapp-." placeholder="xapp-…" autoComplete="off" />}</Field>
          <Field label={<span className="text-xs font-medium text-mute">Bot token</span>} error={fieldError(createChannel.error, 'botToken')}
            hint={<span className={HINT}><b>OAuth & Permissions</b> › <b>Install to</b> your workspace › <b>Allow</b>. Then copy the <b>Bot User OAuth Token</b>.</span>}>{(control) =>
            <Input {...control} mono name="botToken" required pattern="xoxb-[\w\-]{10,}" title="Paste the bot token. It starts with xoxb-." placeholder="xoxb-…" autoComplete="off" />}</Field>
          <Field label={<span className="text-xs font-medium text-mute">Configuration token</span>} error={fieldError(createChannel.error, 'configToken')}
            hint={<span className={HINT}><a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">Your Apps</a> › <b>Your App Configuration Tokens</b> › <b>Generate Token</b>. OpenHut uses it once to give {agent.name} its face, and doesn't keep it.</span>}>{(control) =>
            <Input {...control} mono name="configToken" required pattern="xoxe\.xoxp-[\w.\-]{10,}" title="Paste the configuration access token. It starts with xoxe.xoxp-." placeholder="xoxe.xoxp-…" autoComplete="off" />}</Field>
        </>}
      </Step>
      <Step n={3} title="Pick its channels" state={channel ? 'now' : 'next'}>
        {channel && <SlackChannels key={channel.allowed.join()} agent={agent} channel={channel} lockReason={undefined} />}
      </Step>
    </form>
  </SetupSheet>
}
