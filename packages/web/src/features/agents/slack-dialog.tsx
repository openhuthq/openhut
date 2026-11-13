import type { Agent } from '@fastmonkey/common/agents/agent.ts'
import { ADDRESS, type Channel } from '@fastmonkey/common/channels/channel.ts'
import { slackCreateUrl, slackManifest } from './slack-manifest'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { DialogFoot } from '@/components/dialog-foot'
import { DialogHead } from '@/components/dialog-head'
import { Field } from '@/components/field'
import { ICONS } from '@/components/icons'
import { SetupDialog, SetupFoot, SetupStep, SetupSteps, SetupSubmit, type SetupInfo } from '@/components/setup'
import { useCreateChannel, useUpdateChannel } from '@/features/agents/api'
import { addressPattern, AudienceFields, audienceOf } from '@/features/agents/audience-fields'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'

const FIELDS = ['botToken', 'appToken', 'ownerAddress', 'open', 'allowed']

export function SlackDialog({ agent, channel }: { agent: Agent; channel: Channel | undefined }) {
  const onClosed = () => navigate(`/agents/${agent.id}`)
  if (channel) return <SlackAudienceDialog agent={agent} channel={channel} onClosed={onClosed} />
  return <SlackSetupDialog agent={agent} onClosed={onClosed} />
}

function SlackSetupDialog({ agent, onClosed }: { agent: Agent; onClosed: () => void }) {
  const createChannel = useCreateChannel()
  const manifest = JSON.stringify(slackManifest(agent.name), null, 2)
  const info: SetupInfo = {
    brand: 'slack', title: `Connect ${agent.name} to Slack`, blurb: `${agent.name} gets its own Slack app.`, eta: '3 minutes',
    chips: [['at', 'Mention it in a channel'], ['message', 'DM it']], safe: 'Strangers are ignored. Tokens are sealed on this server.',
  }
  return <SetupDialog info={info} onClosed={onClosed}>{(close) =>
    <form id="slack-main" onSubmit={(event) => {
      const field = formValues(event)
      createChannel.mutate({ kind: 'slack', agentId: agent.id, botToken: field('botToken'), appToken: field('appToken'), ownerAddress: field('ownerAddress'), ...audienceOf(field) }, { onSuccess: close })
    }}>
      <SetupSteps>
        <SetupStep n={1} title="Create the app and install it" state="now" tag="manifest filled in">
          <div className="setup-acts">
            <a className="btn sec sm" href={slackCreateUrl(agent.name)} target="_blank" rel="noreferrer">{ICONS.ext}Create the Slack app</a>
            <CopyButton text={manifest} label="Copy manifest" />
          </div>
        </SetupStep>
        <SetupStep n={2} title="Paste its two tokens">
          <div className="setup-two">
            <Field label="Bot token" error={fieldError(createChannel.error, 'botToken')} hint="OAuth & Permissions">{(control) =>
              <input {...control} name="botToken" className="mono" required pattern="xoxb-[\w\-]{10,}" title="Paste the bot token. It starts with xoxb-." placeholder="xoxb-…" autoComplete="off" />}</Field>
            <Field label="App token" error={fieldError(createChannel.error, 'appToken')} hint="Basic Information, connections:write">{(control) =>
              <input {...control} name="appToken" className="mono" required pattern="xapp-[\w\-]{10,}" title="Paste the app-level token. It starts with xapp-." placeholder="xapp-…" autoComplete="off" />}</Field>
          </div>
        </SetupStep>
        <SetupStep n={3} title="Who can message it">
          <Field label="Your member ID" error={fieldError(createChannel.error, 'ownerAddress')} hint="Your Slack profile › ⋮ › Copy member ID">{(control) =>
            <input {...control} name="ownerAddress" className="mono" required pattern={addressPattern('slack')} title={ADDRESS.slack.message} placeholder="U012AB3CD" autoComplete="off" />}</Field>
          <AudienceFields kind="slack" channel={undefined} error={createChannel.error} />
        </SetupStep>
      </SetupSteps>
      <SetupFoot info={info} cancel={close} error={formError(createChannel.error, FIELDS)}>
        <SetupSubmit form="slack-main" pending={createChannel.isPending} label="Connect" busy="Checking with Slack…" />
      </SetupFoot>
    </form>}
  </SetupDialog>
}

function SlackAudienceDialog({ agent, channel, onClosed }: { agent: Agent; channel: Channel; onClosed: () => void }) {
  const updateChannel = useUpdateChannel()
  return <Dialog labelledBy="slack-h" className="dlg narrow" onClosed={onClosed}>{(close) =>
    <form className="dlgform auto" onSubmit={(event) => updateChannel.mutate({ channelId: channel.id, change: audienceOf(formValues(event)) }, { onSuccess: close })}>
      <DialogHead id="slack-h" title={`Who can message ${agent.name} on Slack`} subtitle={channel.account} onClose={close} />
      <div className="dlgbody"><AudienceFields kind="slack" channel={channel} error={updateChannel.error} /></div>
      <DialogFoot error={formError(updateChannel.error, FIELDS)}>
        <button type="button" className="btn sec" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={updateChannel.isPending}>Save</button>
      </DialogFoot>
    </form>}
  </Dialog>
}
