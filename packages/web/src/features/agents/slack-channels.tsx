import { useCallback, useMemo, useRef, useState } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel, Conversation } from '@openhut/common/channels/channel.ts'
import { ErrorNote } from '@/components/error-note'
import { ICONS, SETUP_ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { useConversations, useUpdateChannel } from '@/features/agents/api'
import { toastError } from '@/lib/toast'

export function SlackChannels({ agent, channel, lockReason }: { agent: Agent; channel: Channel; lockReason: string | undefined }) {
  const conversations = useConversations(channel.id)
  const updateChannel = useUpdateChannel()
  const [picked, setPicked] = useState(channel.allowed)
  const latest = useRef(picked)
  const isOpen = useRef(false)
  const [frame, setFrame] = useState<HTMLElement>()
  const findFrame = useCallback((node: HTMLDivElement | null) => setFrame(node?.closest('dialog') ?? undefined), [])
  const items = useMemo(() => Combobox.createItems(conversations.data ?? [], { getValue: (each) => each.id, getLabel: (each) => each.name }), [conversations.data])
  const known = new Map(conversations.data?.map((each) => [each.id, each]))
  const bot = channel.account?.split('@')[1] ?? agent.name
  const waiting = conversations.data?.filter((each) => each.joined && !channel.allowed.includes(each.id)) ?? []
  const disabled = !agent.canEdit || !!lockReason || updateChannel.isPending
  const pick = (next: string[]) => {
    latest.current = next
    setPicked(next)
  }
  const save = () => {
    const next = latest.current
    if (next.length === channel.allowed.length && next.every((id) => channel.allowed.includes(id))) return
    updateChannel.mutate({ channelId: channel.id, change: { allowed: next } }, { onError: (err) => { pick(channel.allowed); toastError(err) } })
  }
  return <div className="slack-chs" ref={findFrame}>
    <Locked reason={lockReason}>
      <Combobox.Root multiple items={items} value={picked} disabled={disabled}
        onValueChange={(next: string[]) => { pick(next); if (!isOpen.current) save() }}
        onOpenChange={(open) => { isOpen.current = open; if (!open) save() }}>
        <Combobox.InputGroup className="picker">
          <Combobox.Chips className="picker-chips" aria-label={picked.length ? 'Channels' : undefined}>
            {picked.map((id) => <Combobox.Chip key={id} className="pchip" aria-label={known.get(id)?.name ?? id}>
              {glyph(known.get(id))}<span className="ellip">{known.get(id)?.name ?? '…'}</span>
              <Combobox.ChipRemove className="pchip-x" aria-label={`Remove ${known.get(id)?.name ?? id}`}>{ICONS.x}</Combobox.ChipRemove>
            </Combobox.Chip>)}
            <Combobox.Input className="picker-in" placeholder={picked.length ? 'Add a channel' : 'Pick channels'} aria-label="Slack channels" />
          </Combobox.Chips>
        </Combobox.InputGroup>
        <Combobox.Portal container={frame}>
          <Combobox.Positioner className="menupos" side="bottom" align="start" sideOffset={4} positionMethod="fixed">
            <Combobox.Popup className="menu picker-pop">
              <Combobox.Empty><div className="picker-none">{conversations.isPending ? 'Loading channels…' : 'No channel by that name.'}</div></Combobox.Empty>
              <Combobox.List>{(each: Conversation) => <Combobox.Item key={each.id} value={each.id} className="menuitem">
                {glyph(each)}<span className="ellip">{each.name}</span>{each.shared && <span className="picker-tag" title="Shared with people outside this workspace">shared</span>}<span className="picker-n">{each.members}</span>
                <span className="picker-tick"><Combobox.ItemIndicator>{SETUP_ICONS.check}</Combobox.ItemIndicator></span>
              </Combobox.Item>}</Combobox.List>
              <p className="picker-foot">Private channels and group DMs show up here once @{bot} is in them: type /invite @{bot} there.</p>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </Locked>
    <ErrorNote message={conversations.error?.message} />
    {waiting.length > 0 && <div className="picker-wait">
      <span className="mute">In Slack, but {agent.name} doesn't answer there</span>
      {waiting.map((each) => <div className="picker-row" key={each.id}>
        {glyph(each)}<span className="ellip">{each.name}</span>
        <Locked reason={lockReason}><button type="button" className="btn sm sec" disabled={disabled} onClick={() => { pick([...latest.current, each.id]); save() }}>Allow</button></Locked>
      </div>)}
    </div>}
  </div>
}

const GLYPHS = { public: SETUP_ICONS.hash, private: SETUP_ICONS.lock, group: SETUP_ICONS.users }

function glyph(conversation: Conversation | undefined) {
  return GLYPHS[conversation?.type ?? 'public']
}
