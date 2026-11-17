import type { Agent } from '@openhut/common/agents/agent.ts'
import { ADDRESS, type Channel } from '@openhut/common/channels/channel.ts'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Busy, SetupSheet, Step } from '@/components/kit'
import { useCreateChannel, useUpdateChannel } from '@/features/agents/api'
import { addressPattern, AudienceFields, audienceOf } from '@/features/agents/audience-fields'
import { QrCode } from '@/features/agents/qr-code'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'

const FIELDS = ['ownerAddress', 'open', 'allowed']
const LABEL = 'text-xs font-medium text-mute'

export function WhatsappDialog({ agent, channel, onClose }: { agent: Agent; channel: Channel | undefined; onClose: () => void }) {
  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()
  const linking = channel?.status === 'linking'
  const connected = channel?.status === 'connected'
  const pending = createChannel.isPending || updateChannel.isPending
  const foot = linking
    ? <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
    : pending ? <Busy label={connected ? 'Saving…' : 'Starting WhatsApp…'} /> : <><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="wa-main" variant="primary">{connected ? 'Save' : 'Show the code'}</Button></>
  return <SetupSheet brand="whatsapp" title={connected ? `${agent.name} on WhatsApp` : `Connect ${agent.name} to WhatsApp`} blurb={connected ? `Linked to ${channel.account ?? 'its number'}. Pick who can message it.` : `${agent.name} gets its own number. Link it like WhatsApp Web, from the phone that holds that number.`}
    eta={connected ? undefined : '1 minute'} safe="Unknown numbers are dropped before the agent sees them." error={formError(createChannel.error ?? updateChannel.error, FIELDS)} foot={foot} onClose={onClose}>
    <form id="wa-main" className="contents" onSubmit={(event) => {
      const field = formValues(event)
      if (connected) return updateChannel.mutate({ channel, change: audienceOf(field) }, { onSuccess: onClose })
      createChannel.mutate({ kind: 'whatsapp', agentId: agent.id, ownerAddress: field('ownerAddress'), ...audienceOf(field) })
    }}>
      {!connected && <Step n={1} title="Your number" state={linking ? 'done' : 'now'} tag={linking ? channel.ownerAddress : undefined}>
        {!linking && <Field label={<span className={LABEL}>Phone</span>} error={fieldError(createChannel.error, 'ownerAddress')}>{(control) =>
          <Input {...control} mono name="ownerAddress" type="tel" required pattern={addressPattern('whatsapp')} title={ADDRESS.whatsapp.message} placeholder="+15551234567" autoComplete="tel" />}</Field>}
      </Step>}
      <Step n={connected ? 1 : 2} title="Who can message it" state={linking ? 'done' : 'now'}>
        {!linking && <AudienceFields kind="whatsapp" channel={channel} error={createChannel.error ?? updateChannel.error} labelled={false} />}
      </Step>
      {!connected && <Step n={3} title="Scan the code with the agent's phone" state={linking ? 'now' : 'next'}>
        {linking && <div className="flex items-center gap-5">
          <span className="grid size-[176px] shrink-0 place-items-center rounded-xl border border-hair bg-white p-2 [&_canvas]:size-full!">{channel.qr ? <QrCode text={channel.qr} /> : <Spinner className="size-5" />}</span>
          <div className="flex flex-col gap-3">
            <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-4 font-copy text-[12.5px]/[1.5] text-body">
              <li>Open WhatsApp on the agent's phone</li>
              <li><b className="font-medium text-ink">Settings › Linked devices</b></li>
              <li><b className="font-medium text-ink">Link a device</b>, then point it here</li>
            </ol>
            <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-mute"><i className="size-2 animate-pulse rounded-full bg-pass" />{channel.qr ? 'Waiting for scan…' : 'Starting WhatsApp…'}</span>
          </div>
        </div>}
      </Step>}
    </form>
  </SetupSheet>
}
