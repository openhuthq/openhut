import { LinkSquare02Icon } from '@hugeicons/core-free-icons'
import { ADDRESS, type Channel } from '@openhut/common/channels/channel.ts'
import type { Agent } from '@openhut/common/agents/agent.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Busy, HINT, I, PILL, SetupSheet, Step } from '@/components/kit'
import { useCreateChannel, useUpdateChannel } from '@/features/agents/api'
import { addressPattern } from '@/features/agents/audience-fields'
import { fieldError, formError } from '@/lib/api-client'
import { formValues } from '@/lib/form'
import { cn } from '@/lib/utils'

const FIELDS = ['botToken', 'allowed']
const ID = addressPattern('discord')

export function DiscordDialog({ agent, channel, onClose }: { agent: Agent; channel: Channel | undefined; onClose: () => void }) {
  const createChannel = useCreateChannel()
  const updateChannel = useUpdateChannel()
  const pending = createChannel.isPending || updateChannel.isPending
  const error = createChannel.error ?? updateChannel.error
  const foot = pending ? <Busy label={channel ? 'Saving…' : 'Checking with Discord…'} /> : <><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="discord-main" variant="primary">{channel ? 'Save' : 'Connect'}</Button></>
  return <SetupSheet brand="discord" title={channel ? `${agent.name} on Discord` : `Connect ${agent.name} to Discord`} blurb={channel ? `${channel.account ?? 'Its bot'} is live.` : `${agent.name} gets its own Discord bot.`}
    eta={channel ? undefined : '4 minutes'} safe="Only people in its channels can talk to it." error={formError(error, FIELDS)} foot={foot} onClose={onClose}>
    <form id="discord-main" className="contents" onSubmit={(event) => {
      const field = formValues(event)
      const allowed = [...new Set(field('channels').split(/[\s,]+/).filter(Boolean))]
      if (channel) return updateChannel.mutate({ channel, change: { allowed } }, { onSuccess: onClose })
      createChannel.mutate({ kind: 'discord', agentId: agent.id, botToken: field('botToken'), allowed }, { onSuccess: onClose })
    }}>
      {!channel && <>
        <Step n={1} title="Create a bot" state="now">
          <div><a className={cn(buttonVariants({ variant: 'secondary' }), PILL)} href="https://discord.com/developers/applications" target="_blank" rel="noreferrer"><I icon={LinkSquare02Icon} size={12} />Open the Developer Portal</a></div>
          <p className={HINT}><b>New Application</b>, then on <b>Bot</b> turn on <b>Message Content Intent</b>.</p>
        </Step>
        <Step n={2} title="Invite it to your server" state="now">
          <p className={HINT}><b>OAuth2</b> › <b>URL Generator</b>: tick <code>bot</code>, then <b>View Channels</b>, <b>Send Messages</b>, <b>Send Messages in Threads</b>, <b>Create Public Threads</b> and <b>Read Message History</b>. Open the link.</p>
        </Step>
        <Step n={3} title="Paste its token" state="now">
          <Field label={<span className="text-xs font-medium text-mute">Bot token</span>} error={fieldError(createChannel.error, 'botToken')} hint={<span className={HINT}><b>Bot</b> › <b>Reset Token</b>.</span>}>{(control) =>
            <Input {...control} mono name="botToken" required pattern="[\w\-]{20,}\.[\w\-]{4,}\.[\w\-]{20,}" title="Paste the bot token from the Bot page." placeholder="MTIz…" autoComplete="off" />}</Field>
        </Step>
      </>}
      <Step n={channel ? 1 : 4} title="Its channels" state="now">
        <Field label={<span className="text-xs font-medium text-mute">Channel IDs</span>} error={fieldError(error, 'allowed')}
          hint={<span className={HINT}>Turn on <b>Developer Mode</b> in Discord's Advanced settings, then right-click a channel › <b>Copy Channel ID</b>.</span>}>{(control) =>
          <Input {...control} mono name="channels" required defaultValue={channel?.allowed.join(', ')} placeholder="1234567890123456789" autoComplete="off"
            pattern={`[\\s,]*${ID}(?:[\\s,]+${ID})*[\\s,]*`} title={ADDRESS.discord.message} />}</Field>
      </Step>
    </form>
  </SetupSheet>
}
