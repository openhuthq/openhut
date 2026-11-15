import type { Agent } from '@openhut/common/agents/agent.ts'
import { ADDRESS, type Channel } from '@openhut/common/channels/channel.ts'
import { Dialog } from '@/components/dialog'
import { DialogFoot } from '@/components/dialog-foot'
import { DialogHead } from '@/components/dialog-head'
import { Field } from '@/components/field'
import { SetupDialog, SetupFoot, SetupStep, SetupSteps, SetupSubmit, type SetupInfo } from '@/components/setup'
import { useCreateChannel, useUpdateChannel } from '@/features/agents/api'
import { addressPattern, AudienceFields, audienceOf } from '@/features/agents/audience-fields'
import { QrCode } from '@/features/agents/qr-code'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'

const FIELDS = ['ownerAddress', 'open', 'allowed']

export function WhatsappDialog({ agent, channel }: { agent: Agent; channel: Channel | undefined }) {
  const onClosed = () => navigate(`/agents/${agent.id}`)
  if (!channel) return <WhatsappSetupDialog agent={agent} onClosed={onClosed} />
  if (channel.status === 'linking') return <WhatsappLinkDialog agent={agent} qr={channel.qr} onClosed={onClosed} />
  return <WhatsappAudienceDialog agent={agent} channel={channel} onClosed={onClosed} />
}

const WA_INFO = (agent: Agent): SetupInfo => ({
  brand: 'whatsapp', title: `Connect ${agent.name} to WhatsApp`, blurb: `${agent.name} gets its own number.`, eta: '1 minute',
  chips: [['message', 'Chat with it'], ['users', 'People you allow']], safe: 'Unknown numbers are dropped before the agent sees them.',
})

function WhatsappSetupDialog({ agent, onClosed }: { agent: Agent; onClosed: () => void }) {
  const createChannel = useCreateChannel()
  const info = WA_INFO(agent)
  return <SetupDialog info={info} onClosed={onClosed}>{(close) =>
    <form id="wa-main" onSubmit={(event) => {
      const field = formValues(event)
      createChannel.mutate({ kind: 'whatsapp', agentId: agent.id, ownerAddress: field('ownerAddress'), ...audienceOf(field) })
    }}>
      <SetupSteps>
        <SetupStep n={1} title="Your number" state="now">
          <Field label="Phone" error={fieldError(createChannel.error, 'ownerAddress')}>{(control) =>
            <input {...control} name="ownerAddress" type="tel" className="mono" required pattern={addressPattern('whatsapp')} title={ADDRESS.whatsapp.message} placeholder="+15551234567" autoComplete="tel" autoFocus />}</Field>
        </SetupStep>
        <SetupStep n={2} title="Who can message it"><AudienceFields kind="whatsapp" channel={undefined} error={createChannel.error} labelled={false} /></SetupStep>
        <SetupStep n={3} title="Scan the code with the agent's phone" />
      </SetupSteps>
      <SetupFoot info={info} cancel={close} error={formError(createChannel.error, FIELDS)}>
        <SetupSubmit form="wa-main" pending={createChannel.isPending} label="Show the code" busy="Starting WhatsApp…" />
      </SetupFoot>
    </form>}
  </SetupDialog>
}

function WhatsappLinkDialog({ agent, qr, onClosed }: { agent: Agent; qr: string | null; onClosed: () => void }) {
  const info = WA_INFO(agent)
  return <SetupDialog info={info} onClosed={onClosed}>{(close) => <>
    <SetupSteps>
      <SetupStep n={1} title="Your number" state="done" />
      <SetupStep n={2} title="Who can message it" state="done" />
      <SetupStep n={3} title="Scan the code with the agent's phone" state="now">
        <div className="setup-qr"><div className="qr">{qr ? <QrCode text={qr} /> : <span className="mute">Starting WhatsApp…</span>}</div>
          <p className="mute">Settings › Linked devices › Link a device</p></div>
      </SetupStep>
    </SetupSteps>
    <SetupFoot info={info} cancel={close}><button type="button" className="btn primary" onClick={close}>Done</button></SetupFoot>
  </>}</SetupDialog>
}

function WhatsappAudienceDialog({ agent, channel, onClosed }: { agent: Agent; channel: Channel; onClosed: () => void }) {
  const updateChannel = useUpdateChannel()
  return <Dialog labelledBy="wa-h" className="dlg narrow" onClosed={onClosed}>{(close) =>
    <form className="dlgform auto" onSubmit={(event) => updateChannel.mutate({ channelId: channel.id, change: audienceOf(formValues(event)) }, { onSuccess: close })}>
      <DialogHead id="wa-h" title={`Who can message ${agent.name} on WhatsApp`} subtitle={channel.account && `Linked to ${channel.account}`} onClose={close} />
      <div className="dlgbody"><AudienceFields kind="whatsapp" channel={channel} error={updateChannel.error} /></div>
      <DialogFoot error={formError(updateChannel.error, FIELDS)}>
        <button type="button" className="btn sec" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={updateChannel.isPending}>Save</button>
      </DialogFoot>
    </form>}
  </Dialog>
}
