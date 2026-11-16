import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel } from '@openhut/common/channels/channel.ts'
import { slackCreateUrl, slackManifest } from './slack-manifest'
import { avatarPng } from '@/components/avatar'
import { CopyButton } from '@/components/copy-button'
import { Field } from '@/components/field'
import { ICONS } from '@/components/icons'
import { SetupDialog, SetupFoot, SetupStep, SetupSteps, SetupSubmit, type SetupInfo } from '@/components/setup'
import { useCreateChannel } from '@/features/agents/api'
import { SlackChannels } from '@/features/agents/slack-channels'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

const FIELDS = ['botToken', 'appToken', 'configToken']

export function SlackDialog({ agent, channel, lockReason }: { agent: Agent; channel: Channel | undefined; lockReason: string | undefined }) {
  const createChannel = useCreateChannel()
  const manifest = JSON.stringify(slackManifest(agent.name), null, 2)
  const info: SetupInfo = {
    brand: 'slack', title: `Connect ${agent.name} to Slack`, blurb: `${agent.name} gets its own Slack app, with its face, and answers in the channels you pick.`, eta: '4 minutes',
    chips: [['at', 'Mention it in a channel'], ['users', 'Everyone in the channel']], safe: 'Only people in the channels you pick can talk to it. Tokens are sealed on this server.',
  }
  return <SetupDialog info={info} onClosed={() => navigate(`/agents/${agent.id}`)}>{(close) =>
    <form id="slack-main" onSubmit={(event) => {
      const field = formValues(event)
      if (channel) return
      avatarPng({ id: agent.id, about: agent.instructions })
        .then((icon) => createChannel.mutate({ kind: 'slack', agentId: agent.id, botToken: field('botToken'), appToken: field('appToken'), configToken: field('configToken'), icon }))
        .catch(toastError)
    }}>
      <SetupSteps>
        <SetupStep n={1} title="Create the app" state={channel ? 'done' : 'now'} tag="manifest filled in">
          {!channel && <div className="setup-acts">
            <a className="btn sec sm" href={slackCreateUrl(agent.name)} target="_blank" rel="noreferrer">{ICONS.ext}Create the Slack app</a>
            <CopyButton text={manifest} label="Copy manifest" />
          </div>}
        </SetupStep>
        <SetupStep n={2} title="Paste its three tokens" state={channel ? 'done' : 'now'} tag={channel?.account ?? undefined}>
          {!channel && <>
            <Field label="App token" error={fieldError(createChannel.error, 'appToken')}
              hint={<><b>Basic Information</b> › <b>App-Level Tokens</b> › <b>Generate Token and Scopes</b>. Add the <code>connections:write</code> scope, then copy the token.</>}>{(control) =>
              <input {...control} name="appToken" className="mono" required pattern="xapp-[\w\-]{10,}" title="Paste the app-level token. It starts with xapp-." placeholder="xapp-…" autoComplete="off" />}</Field>
            <Field label="Bot token" error={fieldError(createChannel.error, 'botToken')}
              hint={<><b>OAuth & Permissions</b> › <b>Install to</b> your workspace › <b>Allow</b>. Then copy the <b>Bot User OAuth Token</b>.</>}>{(control) =>
              <input {...control} name="botToken" className="mono" required pattern="xoxb-[\w\-]{10,}" title="Paste the bot token. It starts with xoxb-." placeholder="xoxb-…" autoComplete="off" />}</Field>
            <Field label="Configuration token" error={fieldError(createChannel.error, 'configToken')}
              hint={<><a href="https://api.slack.com/apps" target="_blank" rel="noreferrer">Your Apps</a> › <b>Your App Configuration Tokens</b> › <b>Generate Token</b>. Copy the access token. OpenHut uses it once to give {agent.name} its face, and doesn't keep it.</>}>{(control) =>
              <input {...control} name="configToken" className="mono" required pattern="xoxe\.xoxp-[\w.\-]{10,}" title="Paste the configuration access token. It starts with xoxe.xoxp-." placeholder="xoxe.xoxp-…" autoComplete="off" />}</Field>
          </>}
        </SetupStep>
        <SetupStep n={3} title="Pick its channels" state={channel ? 'now' : 'next'}>
          {channel && <SlackChannels key={channel.allowed.join()} agent={agent} channel={channel} lockReason={lockReason} />}
        </SetupStep>
      </SetupSteps>
      <SetupFoot info={info} cancel={close} error={formError(createChannel.error, FIELDS)}>
        {channel
          ? <button type="button" className="btn primary" onClick={close}>Done</button>
          : <SetupSubmit form="slack-main" pending={createChannel.isPending} label="Connect" busy="Checking with Slack…" />}
      </SetupFoot>
    </form>}
  </SetupDialog>
}
