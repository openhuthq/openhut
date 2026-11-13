import type { Agent } from '@fastmonkey/common/agents/agent.ts'
import { ADDRESS, type Channel } from '@fastmonkey/common/channels/channel.ts'
import { Dialog } from '@/components/dialog'
import { DialogFoot } from '@/components/dialog-foot'
import { DialogHead } from '@/components/dialog-head'
import { Field } from '@/components/field'
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

function WhatsappSetupDialog({ agent, onClosed }: { agent: Agent; onClosed: () => void }) {
  const createChannel = useCreateChannel()
  return <Dialog labelledBy="wa-h" className="dlg narrow" onClosed={onClosed}>{(close) =>
    <form className="dlgform auto" onSubmit={(event) => {
      const field = formValues(event)
      createChannel.mutate({ kind: 'whatsapp', agentId: agent.id, ownerAddress: field('ownerAddress'), ...audienceOf(field) })
    }}>
      <DialogHead id="wa-h" title={`Connect ${agent.name} to WhatsApp`} subtitle={`${agent.name} answers on its own WhatsApp number, linked like WhatsApp Web.`} onClose={close} />
      <div className="dlgbody">
        <Field label="Your phone number" error={fieldError(createChannel.error, 'ownerAddress')} hint="With country code. You can always message it.">{(control) =>
          <input {...control} name="ownerAddress" type="tel" className="mono" required pattern={addressPattern('whatsapp')} title={ADDRESS.whatsapp.message} placeholder="+15551234567" autoComplete="tel" />}</Field>
        <AudienceFields kind="whatsapp" channel={undefined} error={createChannel.error} />
      </div>
      <DialogFoot error={formError(createChannel.error, FIELDS)}>
        <button type="button" className="btn sec" onClick={close}>Cancel</button>
        <button className="btn primary" disabled={createChannel.isPending}>Link</button>
      </DialogFoot>
    </form>}
  </Dialog>
}

function WhatsappLinkDialog({ agent, qr, onClosed }: { agent: Agent; qr: string | null; onClosed: () => void }) {
  return <Dialog labelledBy="wa-h" className="dlg narrow" onClosed={onClosed}>{(close) =>
    <div className="dlgform auto">
      <DialogHead id="wa-h" title={`Link ${agent.name} to WhatsApp`} subtitle="Scan the code with the phone whose number it should answer on." onClose={close} />
      <div className="dlgbody qrstep">
        <div className="qr">{qr ? <QrCode text={qr} /> : <span className="mute">Starting WhatsApp…</span>}</div>
        <p>Open WhatsApp › Linked devices › Link a device, then scan</p>
        <p className="hint">The code refreshes by itself.</p>
      </div>
      <DialogFoot><button type="button" className="btn sec" onClick={close}>Close</button></DialogFoot>
    </div>}
  </Dialog>
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
