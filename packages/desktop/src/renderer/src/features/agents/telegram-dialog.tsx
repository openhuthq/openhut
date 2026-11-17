import { LinkSquare02Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel } from '@openhut/common/channels/channel.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Busy, I, PILL, SetupSheet, Step } from '@/components/kit'
import { useCreateChannel, useUpdateChannel } from '@/features/agents/api'
import { changeOf, PeopleField, peopleOf } from '@/features/agents/audience-fields'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { cn } from '@/lib/utils'

const FIELDS = ['botToken', 'ownerAddress', 'open', 'allowed']

export function TelegramDialog({ agent, channel, onClose }: { agent: Agent; channel: Channel | undefined; onClose: () => void }) {
  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()
  const pending = createChannel.isPending || updateChannel.isPending
  const error = createChannel.error ?? updateChannel.error
  const foot = pending ? <Busy label={channel ? 'Saving…' : 'Checking with Telegram…'} /> : <><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="telegram-main" variant="primary">{channel ? 'Save' : 'Connect'}</Button></>
  return <SetupSheet brand="telegram" title={channel ? `${agent.name} on Telegram` : `Connect ${agent.name} to Telegram`} blurb={channel ? `${channel.account ?? 'Its bot'} is live.` : `${agent.name} gets its own Telegram bot.`}
    eta={channel ? undefined : '2 minutes'} safe="Only these people can message it." error={formError(error, FIELDS)} foot={foot} onClose={onClose}>
    <form id="telegram-main" className="contents" onSubmit={(event) => {
      const field = formValues(event)
      if (channel) return updateChannel.mutate({ channel, change: changeOf({ field, channel }) }, { onSuccess: onClose })
      createChannel.mutate({ kind: 'telegram', agentId: agent.id, botToken: field('botToken'), ...peopleOf(field) }, { onSuccess: onClose })
    }}>
      {!channel && <>
        <Step n={1} title="Create a bot" state="now" tag="send /newbot to BotFather">
          <div><a className={cn(buttonVariants({ variant: 'secondary' }), PILL)} href="https://t.me/BotFather" target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={12} />Open BotFather</a></div>
        </Step>
        <Step n={2} title="Paste its token" state="now">
          <Field label={<span className="text-xs font-medium text-mute">Bot token</span>} error={fieldError(createChannel.error, 'botToken')}>{(control) =>
            <Input {...control} mono name="botToken" required pattern="\d{6,}:[\w\-]{30,}" title="Paste the token BotFather gave you." placeholder="123456789:AAE…" autoComplete="off" />}</Field>
        </Step>
      </>}
      <Step n={channel ? 1 : 3} title="Who can message it" state="now">
        <PeopleField kind="telegram" channel={channel} error={error} />
      </Step>
    </form>
  </SetupSheet>
}
