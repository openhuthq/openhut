import type { Agent } from '@openhut/common/agents/agent.ts'
import { ADDRESS, type Channel } from '@openhut/common/channels/channel.ts'
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

const FIELDS = ['botToken', 'ownerAddress', 'open', 'allowed']

export function TelegramDialog({ agent, channel }: { agent: Agent; channel: Channel | undefined }) {
  const onClosed = () => navigate(`/agents/${agent.id}`)
  if (channel) return <TelegramAudienceDialog agent={agent} channel={channel} onClosed={onClosed} />
  return <TelegramSetupDialog agent={agent} onClosed={onClosed} />
}

function TelegramSetupDialog({ agent, onClosed }: { agent: Agent; onClosed: () => void }) {
  const createChannel = useCreateChannel()
  const info: SetupInfo = {
    brand: 'telegram', title: `Connect ${agent.name} to Telegram`, blurb: `${agent.name} gets its own Telegram bot.`, eta: '2 minutes',
    chips: [['message', 'DM it'], ['at', 'Mention it in a group']], safe: 'Strangers are ignored. The token is sealed on this server.',
  }
  return <SetupDialog info={info} onClosed={onClosed}>{(close) =>
    <form id="telegram-main" onSubmit={(event) => {
      const field = formValues(event)
      createChannel.mutate({ kind: 'telegram', agentId: agent.id, botToken: field('botToken'), ownerAddress: field('ownerAddress'), ...audienceOf(field) }, { onSuccess: close })
    }}>
      <SetupSteps>
        <SetupStep n={1} title="Create the bot" state="now" tag="send /newbot">
          <div className="setup-acts">
            <a className="btn sec sm" href="https://t.me/BotFather" target="_blank" rel="noreferrer">{ICONS.ext}Open BotFather</a>
          </div>
        </SetupStep>
        <SetupStep n={2} title="Paste its token">
          <Field label="Bot token" error={fieldError(createChannel.error, 'botToken')} hint="BotFather sends it when the bot is made">{(control) =>
            <input {...control} name="botToken" className="mono" required pattern="\d{6,}:[\w\-]{30,}" title="Paste the token BotFather gave you." placeholder="123456789:AAE…" autoComplete="off" />}</Field>
        </SetupStep>
        <SetupStep n={3} title="Who can message it">
          <Field label="Your user ID" error={fieldError(createChannel.error, 'ownerAddress')} hint="Message @userinfobot to see it">{(control) =>
            <input {...control} name="ownerAddress" className="mono" required pattern={addressPattern('telegram')} title={ADDRESS.telegram.message} placeholder="123456789" autoComplete="off" />}</Field>
          <AudienceFields kind="telegram" channel={undefined} error={createChannel.error} labelled={false} />
        </SetupStep>
      </SetupSteps>
      <SetupFoot info={info} cancel={close} error={formError(createChannel.error, FIELDS)}>
        <SetupSubmit form="telegram-main" pending={createChannel.isPending} label="Connect" busy="Checking with Telegram…" />
      </SetupFoot>
    </form>}
  </SetupDialog>
}

function TelegramAudienceDialog({ agent, channel, onClosed }: { agent: Agent; channel: Channel; onClosed: () => void }) {
  const updateChannel = useUpdateChannel()
  return <Dialog labelledBy="telegram-h" className="dlg narrow" onClosed={onClosed}>{(close) =>
    <form className="dlgform auto" onSubmit={(event) => updateChannel.mutate({ channelId: channel.id, change: audienceOf(formValues(event)) }, { onSuccess: close })}>
      <DialogHead id="telegram-h" title={`Who can message ${agent.name} on Telegram`} subtitle={channel.account} onClose={close} />
      <div className="dlgbody"><AudienceFields kind="telegram" channel={channel} error={updateChannel.error} /></div>
      <DialogFoot error={formError(updateChannel.error, FIELDS)}>
        <button type="button" className="btn sec" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={updateChannel.isPending}>Save</button>
      </DialogFoot>
    </form>}
  </Dialog>
}
