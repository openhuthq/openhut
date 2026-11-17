import { LinkSquare02Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { ADDRESS, type Channel } from '@openhut/common/channels/channel.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Busy, I, SetupSheet, Step } from '@/components/kit'
import { useCreateChannel, useUpdateChannel } from '@/features/agents/api'
import { addressPattern, AudienceFields, audienceOf } from '@/features/agents/audience-fields'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'

const FIELDS = ['botToken', 'ownerAddress', 'open', 'allowed']
const LABEL = 'text-xs font-medium text-mute'
const BUBBLE = 'rounded-[12px_12px_12px_4px] bg-card px-2.5 py-1 shadow-[inset_0_0_0_1px_var(--hair)]'
const MINE = 'self-end rounded-[12px_12px_4px_12px] bg-ink px-2.5 py-1 text-white'

export function TelegramDialog({ agent, channel, onClose }: { agent: Agent; channel: Channel | undefined; onClose: () => void }) {
  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()
  const pending = createChannel.isPending || updateChannel.isPending
  const slug = `${agent.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_bot`
  const foot = pending ? <Busy label={channel ? 'Saving…' : 'Checking with Telegram…'} /> : <><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="telegram-main" variant="primary">{channel ? 'Save' : 'Connect'}</Button></>
  return <SetupSheet brand="telegram" title={channel ? `${agent.name} on Telegram` : `Connect ${agent.name} to Telegram`} blurb={channel ? `${channel.account ?? 'Its bot'} is live. Pick who can message it.` : `${agent.name} gets its own Telegram bot. DM it, or mention it in a group.`}
    eta={channel ? undefined : '2 minutes'} safe="Strangers are ignored. The token is sealed on this server." error={formError(createChannel.error ?? updateChannel.error, FIELDS)} foot={foot} onClose={onClose}>
    <form id="telegram-main" className="contents" onSubmit={(event) => {
      const field = formValues(event)
      if (channel) return updateChannel.mutate({ channel, change: audienceOf(field) }, { onSuccess: onClose })
      createChannel.mutate({ kind: 'telegram', agentId: agent.id, botToken: field('botToken'), ownerAddress: field('ownerAddress'), ...audienceOf(field) }, { onSuccess: onClose })
    }}>
      {!channel && <>
        <Step n={1} title="Create the bot" state="now" tag="send /newbot">
          <div><a className={buttonVariants({ variant: 'secondary', size: 'sm' })} href="https://t.me/BotFather" target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={14} />Open BotFather</a></div>
          <div className="flex flex-col gap-1.5 rounded-lg bg-[oklch(0%_0_0/.03)] p-3 font-mono text-[11.5px]/[1.5]">
            <span className={MINE}>/newbot</span>
            <span className={`w-fit ${BUBBLE}`}>Alright, a new bot. How are we going to call it?</span>
            <span className={MINE}>{slug}</span>
            <span className={`w-fit ${BUBBLE}`}>Done! Use this token to access the HTTP API: 7413…</span>
          </div>
        </Step>
        <Step n={2} title="Paste its token" state="now">
          <Field label={<span className={LABEL}>Bot token</span>} error={fieldError(createChannel.error, 'botToken')} hint="BotFather sends it when the bot is made">{(control) =>
            <Input {...control} mono name="botToken" required pattern="\d{6,}:[\w\-]{30,}" title="Paste the token BotFather gave you." placeholder="123456789:AAE…" autoComplete="off" />}</Field>
        </Step>
      </>}
      <Step n={channel ? 1 : 3} title="Who can message it" state="now">
        {!channel && <Field label={<span className={LABEL}>Your user ID</span>} error={fieldError(createChannel.error, 'ownerAddress')} hint="Message @userinfobot to see it">{(control) =>
          <Input {...control} mono name="ownerAddress" required pattern={addressPattern('telegram')} title={ADDRESS.telegram.message} placeholder="123456789" autoComplete="off" />}</Field>}
        <AudienceFields kind="telegram" channel={channel} error={createChannel.error ?? updateChannel.error} labelled={false} />
      </Step>
    </form>
  </SetupSheet>
}
