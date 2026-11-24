import { useMemo, useRef, useState } from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Channel, Conversation } from '@openhut/common/channels/channel.ts'
import { Badge } from '@/components/ui/badge'
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxItemIndicator, ComboboxList } from '@/components/ui/combobox'
import { ErrorNote } from '@/components/error-note'
import { SETUP_ICONS } from '@/components/icons'
import { useConversations, useUpdateChannel } from '@/features/agents/api'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

export function SlackChannels({ agent, channel, inset = false }: { agent: Agent; channel: Channel; inset?: boolean }) {
  const conversations = useConversations(channel)
  const updateChannel = useUpdateChannel()
  const [picked, setPicked] = useState(channel.allowed)
  const latest = useRef(picked)
  const isOpen = useRef(false)
  const items = useMemo(() => ComboboxPrimitive.createItems(conversations.data ?? [], { getValue: (each) => each.id, getLabel: (each) => each.name }), [conversations.data])
  const known = new Map(conversations.data?.map((each) => [each.id, each]))
  const bot = channel.account?.split('@')[1] ?? agent.name
  const disabled = !agent.canEdit || updateChannel.isPending
  const pick = (next: string[]) => {
    latest.current = next
    setPicked(next)
  }
  const save = () => {
    const next = latest.current
    if (next.length === channel.allowed.length && next.every((id) => channel.allowed.includes(id))) return
    updateChannel.mutate({ channel, change: { allowed: next } }, { onError: (err) => { pick(channel.allowed); toastError(err) } })
  }
  return <div className={cn('flex min-w-0 flex-col gap-2', inset && 'pr-3 pb-3 pl-[46px]')}>
      <Combobox multiple items={items} value={picked} disabled={disabled}
        onValueChange={(next: string[]) => { pick(next); if (!isOpen.current) save() }}
        onOpenChange={(open) => { isOpen.current = open; if (!open) save() }}>
        <ComboboxChips aria-label={picked.length ? 'Channels' : undefined}>
          {picked.map((id) => <ComboboxChip key={id} aria-label={known.get(id)?.name ?? id} removeLabel={`Remove ${known.get(id)?.name ?? id}`}>
            {glyph(known.get(id))}<span className="truncate">{known.get(id)?.name ?? '…'}</span>
          </ComboboxChip>)}
          <ComboboxChipsInput placeholder={picked.length ? 'Add a channel' : 'Pick channels'} aria-label="Slack channels" />
        </ComboboxChips>
        <ComboboxContent>
          <ComboboxEmpty><div className="px-2 py-1.5 text-mute">{conversations.isPending ? 'Loading channels…' : 'No channel by that name.'}</div></ComboboxEmpty>
          <ComboboxList>{(each: Conversation) => <ComboboxItem key={each.id} value={each.id}>
            {glyph(each)}<span className="truncate">{each.name}</span>{each.shared && <Badge variant="count" title="Shared with people outside this workspace">shared</Badge>}<span className="ml-auto pl-2 font-mono text-xs text-mute">{each.members}</span>
            <span className="grid w-3.5 shrink-0 place-items-center text-ink"><ComboboxItemIndicator>{SETUP_ICONS.check}</ComboboxItemIndicator></span>
          </ComboboxItem>}</ComboboxList>
          <p className="-mx-1 mt-1 -mb-1 border-t border-hair px-3 py-2 text-xs text-mute">Private channels and group DMs show up here once @{bot} is in them: type /invite @{bot} there.</p>
        </ComboboxContent>
      </Combobox>
    <ErrorNote message={conversations.error?.message} />
  </div>
}

const GLYPHS = { public: SETUP_ICONS.hash, private: SETUP_ICONS.lock, group: SETUP_ICONS.users }

function glyph(conversation: Conversation | undefined) {
  return GLYPHS[conversation?.type ?? 'public']
}
