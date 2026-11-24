import { Copy01Icon, LinkSquare02Icon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel } from '@openhut/common/channels/channel.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Busy, I, PILL, SetupSheet, Step } from '@/components/kit'
import { useCreateChannel, useTelegramInvite, useUpdateChannel } from '@/features/agents/api'
import { QrCode } from '@/features/agents/qr-code'
import { fieldError, formError } from '@/lib/api-client'
import { copyText } from '@/lib/clipboard'
import { formValues } from '@/lib/form'
import { toast, toastError, toastFailed } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function TelegramDialog({ agent, channel, onClose }: { agent: Agent; channel: Channel | undefined; onClose: () => void }) {
  const createChannel = useCreateChannel()
  const linking = channel?.status === 'linking'
  const connected = channel?.status === 'connected'
  const owner = connected ? nameOf(channel, channel.ownerAddress) : undefined
  const foot = connected || linking
    ? <Button type="button" variant={connected ? 'primary' : 'secondary'} onClick={onClose}>{connected ? 'Done' : 'Close'}</Button>
    : createChannel.isPending ? <Busy label="Checking with Telegram…" /> : <><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="telegram-main" variant="primary">Next</Button></>
  return <SetupSheet brand="telegram" title={connected ? `${agent.name} on Telegram` : `Connect ${agent.name} to Telegram`} blurb={connected ? `${channel.account ?? 'Its bot'} is live.` : `${agent.name} gets its own Telegram bot.`}
    eta={channel ? undefined : '2 minutes'} safe="Only people you let in can message it." error={formError(createChannel.error, ['botToken'])} foot={foot} onClose={onClose}>
    <form id="telegram-main" className="contents" onSubmit={(event) => {
      const field = formValues(event)
      createChannel.mutate({ kind: 'telegram', agentId: agent.id, botToken: field('botToken'), open: false, allowed: [] })
    }}>
      <Step n={1} title={`Make ${agent.name}’s bot`} state={channel ? 'done' : 'now'} tag={channel?.account ?? undefined}>
        {!channel && <>
          <div><a className={cn(buttonVariants({ variant: 'secondary' }), PILL)} href="https://t.me/BotFather" target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={12} />Open BotFather</a></div>
          <p className="m-0 text-[12px]/[16px] text-mute">Send <b className="font-medium text-body">/newbot</b>, give it a name, then a username ending in <b className="font-medium text-body">bot</b>.</p>
          <Field label={<span className="text-xs font-medium text-mute">Then paste the token BotFather sends</span>} error={fieldError(createChannel.error, 'botToken')}>{(control) =>
            <Input {...control} mono name="botToken" required pattern="\d{6,}:[\w\-]{30,}" title="Paste the token BotFather gave you." placeholder="123456789:AAE…" autoComplete="off" />}</Field>
        </>}
      </Step>
    </form>
    <Step n={2} title="Make it yours" state={connected ? 'done' : linking ? 'now' : 'next'} tag={owner}>
      {linking && <Claim channel={channel} />}
    </Step>
    <Step n={3} title="Anyone else?" state={connected ? 'now' : 'next'} tag={connected ? 'optional' : undefined}>
      {connected && <People channel={channel} />}
    </Step>
  </SetupSheet>
}

function Claim({ channel }: { channel: Channel }) {
  return <div className="flex items-center gap-4">
    <span className="grid size-[120px] shrink-0 place-items-center rounded-xl border border-hair bg-white p-1.5 [&_canvas]:size-full!">{channel.qr ? <QrCode text={channel.qr} label="Telegram start link" /> : <Spinner className="size-5" />}</span>
    <div className="flex flex-col gap-2.5">
      {channel.qr && <div><a className={cn(buttonVariants({ variant: 'secondary' }), PILL)} href={channel.qr} target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={12} />Open {channel.account}</a></div>}
      <p className="m-0 text-[12px]/[16px] text-mute">Or scan with your phone, then tap <b className="font-medium text-body">Start</b>. Whoever taps first becomes the owner.</p>
      <span className="inline-flex items-center gap-2 text-[12px] text-mute"><i className="size-2 animate-pulse rounded-full bg-pass" />Waiting for you to tap Start…</span>
    </div>
  </div>
}

function People({ channel }: { channel: Channel }) {
  const invite = useTelegramInvite()
  const update = useUpdateChannel()
  const copy = () => invite.mutate(channel, {
    onSuccess: ({ url }) => void copyText(url).then((copied) => copied ? toast('Invite link copied') : toastFailed('Couldn’t copy the link', url)),
    onError: toastError,
  })
  const remove = (id: string) => update.mutate({ channel, change: { allowed: channel.allowed.filter((each) => each !== id) } }, { onError: toastError })
  return <>
    <div className="flex flex-col gap-1.5">
      <Person name={nameOf(channel, channel.ownerAddress)} note="you · owner" />
      {channel.allowed.map((id) => <Person key={id} name={nameOf(channel, id)} note={<Button type="button" variant="link" className="text-[12px] text-mute" disabled={update.isPending} onClick={() => remove(id)}>Remove</Button>} />)}
    </div>
    <div><Button type="button" variant="secondary" className={PILL} disabled={invite.isPending} onClick={copy}><I icon={Copy01Icon} size={12} />Copy invite link</Button></div>
    <p className="m-0 text-[12px]/[16px] text-mute">Send it to someone. When they tap Start, they’re in. The link works once, for 24 hours.</p>
  </>
}

function Person({ name, note }: { name: string; note: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-[13px]">
    <span className="grid size-[22px] place-items-center rounded-full bg-soft text-[11px] font-semibold text-body">{name[0]?.toUpperCase()}</span>
    <span className="min-w-0 truncate">{name}</span>
    <span className="ml-auto text-[12px] text-mute">{note}</span>
  </div>
}

function nameOf(channel: Channel, id: string): string {
  return channel.names?.[id] ?? `Telegram user ${id}`
}
