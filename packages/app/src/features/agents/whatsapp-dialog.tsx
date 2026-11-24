import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel } from '@openhut/common/channels/channel.ts'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Busy, SetupSheet, Step } from '@/components/kit'
import { useCreateChannel, useUpdateChannel } from '@/features/agents/api'
import { changeOf, PeopleField, peopleOf } from '@/features/agents/audience-fields'
import { QrCode } from '@/features/agents/qr-code'
import { formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'

const FIELDS = ['ownerAddress', 'open', 'allowed']

export function WhatsappDialog({ agent, channel, onClose }: { agent: Agent; channel: Channel | undefined; onClose: () => void }) {
  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()
  const linking = channel?.status === 'linking'
  const connected = channel?.status === 'connected'
  const pending = createChannel.isPending || updateChannel.isPending
  const foot = linking
    ? <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
    : pending ? <Busy label={connected ? 'Saving…' : 'Starting WhatsApp…'} /> : <><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="wa-main" variant="primary">{connected ? 'Save' : 'Show the code'}</Button></>
  return <SetupSheet brand="whatsapp" title={connected ? `${agent.name} on WhatsApp` : `Connect ${agent.name} to WhatsApp`} blurb={connected ? `Linked to ${channel.account ?? 'its number'}.` : `${agent.name} gets its own number, linked like WhatsApp Web.`}
    eta={connected ? undefined : '1 minute'} safe="Only these people can message it." error={formError(createChannel.error ?? updateChannel.error, FIELDS)} foot={foot} onClose={onClose}>
    <form id="wa-main" className="contents" onSubmit={(event) => {
      const field = formValues(event)
      if (connected) return updateChannel.mutate({ channel, change: changeOf({ field, channel }) }, { onSuccess: onClose })
      createChannel.mutate({ kind: 'whatsapp', agentId: agent.id, ...peopleOf(field) })
    }}>
      <Step n={1} title="Who can message it" state={linking ? 'done' : 'now'}>
        {!linking && <PeopleField kind="whatsapp" channel={channel} error={createChannel.error ?? updateChannel.error} />}
      </Step>
      {!connected && <Step n={2} title="Scan the code with the agent's phone" state={linking ? 'now' : 'next'}>
        {linking && <div className="flex items-center gap-5">
          <span className="grid size-[176px] shrink-0 place-items-center rounded-xl border border-hair bg-white p-2 [&_canvas]:size-full!">{channel.qr ? <QrCode text={channel.qr} /> : <Spinner className="size-5" />}</span>
          <div className="flex flex-col gap-3">
            <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-4 text-[13px]/[18px] text-body">
              <li>Open WhatsApp on the agent's phone</li>
              <li><b className="font-medium text-ink">Settings › Linked devices</b></li>
              <li><b className="font-medium text-ink">Link a device</b>, then point it here</li>
            </ol>
            <span className="inline-flex items-center gap-2 text-[12px] text-mute"><i className="size-2 animate-pulse rounded-full bg-pass" />{channel.qr ? 'Waiting for scan…' : 'Starting WhatsApp…'}</span>
          </div>
        </div>}
      </Step>}
    </form>
  </SetupSheet>
}
