import { useMemo, type ReactNode } from 'react'
import { Combobox as ComboboxPrimitive } from '@base-ui/react/combobox'
import type { Conversation } from '@openhut/common/channels/channel.ts'
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxItemIndicator, ComboboxList } from '@/components/ui/combobox'
import { SETUP_ICONS } from '@/components/icons'

const GLYPHS = { public: SETUP_ICONS.hash, private: SETUP_ICONS.lock, group: SETUP_ICONS.users }

export function ChannelPicker({ label, conversations, loading, value, onChange, onOpenChange, disabled, note, blocked, footer }: {
  label: string
  conversations: Conversation[]
  loading: boolean
  value: string[]
  onChange: (next: string[]) => void
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  note?: (each: Conversation) => ReactNode
  blocked?: (each: Conversation) => string | undefined
  footer?: ReactNode
}) {
  const items = useMemo(() => ComboboxPrimitive.createItems(conversations, { getValue: (each) => each.id, getLabel: (each) => each.name }), [conversations])
  const known = new Map(conversations.map((each) => [each.id, each]))
  return <Combobox multiple items={items} value={value} disabled={disabled} onValueChange={(next: string[]) => onChange(next)} onOpenChange={onOpenChange}>
    <ComboboxChips aria-label={value.length ? 'Channels' : undefined}>
      {value.map((id) => <ComboboxChip key={id} aria-label={known.get(id)?.name ?? id} removeLabel={`Remove ${known.get(id)?.name ?? id}`}>
        {GLYPHS[known.get(id)?.type ?? 'public']}<span className="truncate">{known.get(id)?.name ?? '…'}</span>
      </ComboboxChip>)}
      <ComboboxChipsInput placeholder={value.length ? 'Add a channel' : 'Pick channels'} aria-label={label} />
    </ComboboxChips>
    <ComboboxContent>
      <ComboboxEmpty><div className="px-2 py-1.5 text-mute">{loading ? 'Loading channels…' : 'No channel by that name.'}</div></ComboboxEmpty>
      <ComboboxList>{(each: Conversation) => {
        const hint = blocked?.(each)
        return <ComboboxItem key={each.id} value={each.id} disabled={!!hint} className={hint ? 'h-auto items-start py-1.5' : undefined}>
          {GLYPHS[each.type]}
          <span className="flex min-w-0 flex-col"><span className="truncate">{each.name}</span>{hint && <span className="text-xs text-mute">{hint}</span>}</span>
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">{note?.(each)}</span>
          <span className="grid w-3.5 shrink-0 place-items-center text-ink"><ComboboxItemIndicator>{SETUP_ICONS.check}</ComboboxItemIndicator></span>
        </ComboboxItem>
      }}</ComboboxList>
      {footer && <p className="-mx-1 mt-1 -mb-1 border-t border-hair px-3 py-2 text-xs text-mute">{footer}</p>}
    </ComboboxContent>
  </Combobox>
}
