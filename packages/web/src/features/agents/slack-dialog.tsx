import type { Agent } from '@jakebox/common/agents/agent.ts'
import { ADDRESS, slackCreateUrl, slackManifest, type Channel } from '@jakebox/common/channels/channel.ts'
import { CopyButton } from '@/components/copy-button'
import { Dialog } from '@/components/dialog'
import { DialogFoot } from '@/components/dialog-foot'
import { DialogHead } from '@/components/dialog-head'
import { Field } from '@/components/field'
import { ICONS } from '@/components/icons'
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
  return <Dialog labelledBy="slack-h" className="dlg narrow" onClosed={onClosed}>{(close) =>
    <form className="dlgform auto" onSubmit={(event) => {
      const field = formValues(event)
      createChannel.mutate({ kind: 'slack', agentId: agent.id, botToken: field('botToken'), appToken: field('appToken'), ownerAddress: field('ownerAddress'), ...audienceOf(field) }, { onSuccess: close })
    }}>
      <DialogHead id="slack-h" title={`Connect ${agent.name} to Slack`} subtitle={`${agent.name} gets its own Slack app. People message it in a DM or mention it in a channel.`} onClose={close} />
      <div className="dlgbody">
        <div className="step">
          <h3><span className="stepn">1</span>Create the Slack app</h3>
          <p className="mute">Slack opens with our manifest filled in. Pick your workspace, create the app, then install it to the workspace.</p>
          <div><a className="btn sec" href={slackCreateUrl(agent.name)} target="_blank" rel="noreferrer">{ICONS.ext}Create the Slack app</a></div>
          <details className="manifest"><summary>Show the manifest</summary><pre>{manifest}</pre><CopyButton text={manifest} label="Copy manifest" /></details>
        </div>
        <div className="step">
          <h3><span className="stepn">2</span>Paste the tokens</h3>
          <Field label="Bot token" error={fieldError(createChannel.error, 'botToken')} hint="OAuth & Permissions › Bot User OAuth Token">{(control) =>
            <input {...control} name="botToken" className="mono" required pattern="xoxb-[\w\-]{10,}" title="Paste the bot token. It starts with xoxb-." placeholder="xoxb-…" autoComplete="off" />}</Field>
          <Field label="App-level token" error={fieldError(createChannel.error, 'appToken')} hint="Basic Information › App-Level Tokens, with the connections:write scope">{(control) =>
            <input {...control} name="appToken" className="mono" required pattern="xapp-[\w\-]{10,}" title="Paste the app-level token. It starts with xapp-." placeholder="xapp-…" autoComplete="off" />}</Field>
          <Field label="Your Slack member ID" error={fieldError(createChannel.error, 'ownerAddress')} hint="In Slack: your profile › ⋮ › Copy member ID">{(control) =>
            <input {...control} name="ownerAddress" className="mono" required pattern={addressPattern('slack')} title={ADDRESS.slack.message} placeholder="U012AB3CD" autoComplete="off" />}</Field>
        </div>
        <AudienceFields kind="slack" channel={undefined} error={createChannel.error} />
      </div>
      <DialogFoot error={formError(createChannel.error, FIELDS)}>
        <button type="button" className="btn sec" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={createChannel.isPending}>Connect</button>
      </DialogFoot>
    </form>}
  </Dialog>
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
