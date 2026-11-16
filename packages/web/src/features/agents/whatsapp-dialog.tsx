import type { Agent } from '@openhut/common/agents/agent.ts'
import { ADDRESS, type Channel } from '@openhut/common/channels/channel.ts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogFoot, DialogFrame, DialogHead } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
  return <SetupDialog info={info} onClose={onClosed}>
    <form id="wa-main" onSubmit={(event) => {
      const field = formValues(event)
      createChannel.mutate({ kind: 'whatsapp', agentId: agent.id, ownerAddress: field('ownerAddress'), ...audienceOf(field) })
    }}>
      <SetupSteps>
        <SetupStep n={1} title="Your number" state="now">
          <Field label="Phone" error={fieldError(createChannel.error, 'ownerAddress')}>{(control) =>
            <Input {...control} mono name="ownerAddress" type="tel" required pattern={addressPattern('whatsapp')} title={ADDRESS.whatsapp.message} placeholder="+15551234567" autoComplete="tel" />}</Field>
        </SetupStep>
        <SetupStep n={2} title="Who can message it"><AudienceFields kind="whatsapp" channel={undefined} error={createChannel.error} labelled={false} /></SetupStep>
        <SetupStep n={3} title="Scan the code with the agent's phone" />
      </SetupSteps>
      <SetupFoot info={info} cancel={onClosed} error={formError(createChannel.error, FIELDS)}>
        <SetupSubmit form="wa-main" pending={createChannel.isPending} label="Show the code" busy="Starting WhatsApp…" />
      </SetupFoot>
    </form>
  </SetupDialog>
}

function WhatsappLinkDialog({ agent, qr, onClosed }: { agent: Agent; qr: string | null; onClosed: () => void }) {
  const info = WA_INFO(agent)
  return <SetupDialog info={info} onClose={onClosed}>
    <SetupSteps>
      <SetupStep n={1} title="Your number" state="done" />
      <SetupStep n={2} title="Who can message it" state="done" />
      <SetupStep n={3} title="Scan the code with the agent's phone" state="now">
        <div className="flex items-center gap-[18px]"><div className="grid size-40 place-items-center rounded-xl border border-hair bg-white p-2 shadow-[0_0_0_1px_var(--hair)] [&_canvas]:block">{qr ? <QrCode text={qr} /> : <span className="text-mute">Starting WhatsApp…</span>}</div>
          <p className="m-0 text-mute">Settings › Linked devices › Link a device</p></div>
      </SetupStep>
    </SetupSteps>
    <SetupFoot info={info} cancel={onClosed}><Button type="button" variant="primary" onClick={onClosed}>Done</Button></SetupFoot>
  </SetupDialog>
}

function WhatsappAudienceDialog({ agent, channel, onClosed }: { agent: Agent; channel: Channel; onClosed: () => void }) {
  const updateChannel = useUpdateChannel()
  return <Dialog size="narrow" onClose={onClosed}>
    <DialogFrame height="auto" onSubmit={(event) => updateChannel.mutate({ channelId: channel.id, change: audienceOf(formValues(event)) }, { onSuccess: onClosed })}>
      <DialogHead title={`Who can message ${agent.name} on WhatsApp`} subtitle={channel.account && `Linked to ${channel.account}`} onClose={onClosed} />
      <DialogBody><AudienceFields kind="whatsapp" channel={channel} error={updateChannel.error} /></DialogBody>
      <DialogFoot error={formError(updateChannel.error, FIELDS)}>
        <Button type="button" variant="secondary" onClick={onClosed}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={updateChannel.isPending}>Save</Button>
      </DialogFoot>
    </DialogFrame>
  </Dialog>
}
