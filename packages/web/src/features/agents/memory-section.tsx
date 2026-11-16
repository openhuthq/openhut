import { useState } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Memory, MemoryTarget } from '@openhut/common/agents/memory.ts'
import { Button } from '@/components/ui/button'
import { DialogBody, DialogBox, DialogHead } from '@/components/ui/dialog'
import { ItemGroup, itemVariants } from '@/components/ui/item'
import { Meter as MeterBar } from '@/components/ui/meter'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Sheet } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { Fact } from '@/components/facts'
import { AUTOMATION_ICONS, FACT_ICONS, ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { SectionHead } from '@/components/section-head'
import { useMemory, useUpdateMemory } from '@/features/agents/api'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const FORM = 'flex flex-col gap-2 px-3 py-2.5'
const TEXT = 'm-0 min-w-0 flex-1 leading-[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap'

const KINDS: { target: MemoryTarget; label: string; icon: keyof typeof AUTOMATION_ICONS }[] = [
  { target: 'people', label: 'People', icon: 'person' },
  { target: 'notes', label: 'Notes', icon: 'note' },
]

export function MemoryRow({ agent }: { agent: Agent }) {
  const memory = useMemory(agent.id)
  const count = memory.data ? memory.data.notes.entries.length + memory.data.people.entries.length : undefined
  return <Fact icon={FACT_ICONS.memory} label="Memory">
    <Button type="button" variant="secondary" size="sm" onClick={() => navigate(`/agents/${agent.id}/memory`)}>{count === undefined ? 'Manage' : `${entriesLabel(count)} · Manage`}</Button>
  </Fact>
}

function entriesLabel(count: number): string {
  return count === 1 ? '1 entry' : `${count} entries`
}

export function MemorySheet({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const memory = useMemory(agent.id)
  const [adding, setAdding] = useState(false)
  const close = () => navigate(`/agents/${agent.id}`)
  return <Sheet onClose={close}>
    <DialogBox height="full">
      <DialogHead title={`${agent.name}'s memory`} subtitle={`${agent.name} saves these itself as it works. Changes apply from its next conversation.`} onClose={close} />
      <DialogBody>
        <ErrorNote message={memory.error?.message} />
        {memory.data && <>
          <SectionHead flush action={<Locked reason={lockReason ?? (KINDS.some((kind) => memory.data[kind.target].saved) ? undefined : `${agent.name} hasn't saved any memory yet. You can add to it once it has.`)}>
            <Button type="button" size="sm" disabled={!agent.canEdit || adding || !KINDS.some((kind) => memory.data[kind.target].saved)} onClick={() => setAdding(true)}>{ICONS.plus}Add</Button>
          </Locked>}>
            <span className="inline-flex flex-wrap gap-3.5">{KINDS.map((kind) => <Meter key={kind.target} label={kind.label} used={memory.data[kind.target].used} limit={memory.data[kind.target].limit} />)}</span>
          </SectionHead>
          <MemoryList agent={agent} memory={memory.data} adding={adding} onAdded={() => setAdding(false)} />
        </>}
      </DialogBody>
    </DialogBox>
  </Sheet>
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const full = used >= limit
  return <span className="inline-flex items-center gap-1.5 text-xs">
    <span className="text-mute">{label}</span>
    <MeterBar size="xs" full={full} aria-label={`${label} used`} min={0} max={limit} value={Math.min(used, limit)} />
    <span className="text-mute">{Math.round(used / limit * 100)}% full</span>
  </span>
}

function MemoryList({ agent, memory, adding, onAdded }: { agent: Agent; memory: Memory; adding: boolean; onAdded: () => void }) {
  const update = useUpdateMemory(agent.id)
  const [editing, setEditing] = useState<string | null>(null)
  const entries = KINDS.flatMap((kind) => memory[kind.target].entries.map((text, index) => ({ kind, text, index, key: `${kind.target}-${index}` })))
  const save = ({ target, list, done }: { target: MemoryTarget; list: string[]; done: () => void }) => update.mutate({ [target]: list }, { onSuccess: done, onError: toastError })
  return <ItemGroup>
    {adding && <form className={FORM} onSubmit={(event) => {
      const value = formValues(event)
      const target = value('kind') === 'notes' ? 'notes' : 'people'
      save({ target, list: [...memory[target].entries, value('text')], done: onAdded })
    }}>
      <RadioGroup name="kind" variant="segmented" className="w-[220px]">{KINDS.map((kind) => <RadioGroupItem key={kind.target} value={kind.target} title={memory[kind.target].saved ? undefined : `${agent.name} hasn't saved any ${kind.label.toLowerCase()} yet`}
        disabled={!memory[kind.target].saved} defaultChecked={kind.target === KINDS.find((each) => memory[each.target].saved)?.target}>{AUTOMATION_ICONS[kind.icon]}{kind.label === 'People' ? 'Person' : 'Note'}</RadioGroupItem>)}</RadioGroup>
      <Textarea name="text" className="min-h-[76px]" aria-label="New memory entry" required autoFocus placeholder={`What should ${agent.name} remember?`} />
      <FormActions onCancel={onAdded} busy={update.isPending} />
    </form>}
    {!entries.length && !adding && <p className="m-0 px-4 py-3.5 text-mute">{agent.name} hasn't saved anything yet.</p>}
    {entries.map((entry) => editing === entry.key
      ? <form key={entry.key} className={FORM} onSubmit={(event) => save({ target: entry.kind.target, list: memory[entry.kind.target].entries.map((each, j) => j === entry.index ? formValues(event)('text') : each), done: () => setEditing(null) })}>
        <Textarea name="text" className="min-h-[76px]" aria-label="Memory entry" required autoFocus defaultValue={entry.text} />
        <FormActions onCancel={() => setEditing(null)} busy={update.isPending} />
      </form>
      : <div className={cn(itemVariants(), 'items-start py-2.5')} key={entry.key}>
        <span className="shrink-0 pt-[3px] text-mute" title={entry.kind.label}>{AUTOMATION_ICONS[entry.kind.icon]}</span>
        {agent.canEdit
          ? <Button type="button" variant="bare" className={cn(TEXT, 'cursor-text rounded-[4px] not-disabled:hover:bg-tint')} title="Click to edit" disabled={editing !== null} onClick={() => setEditing(entry.key)}>{entry.text}</Button>
          : <p className={TEXT}>{entry.text}</p>}
        {agent.canEdit && <span className="-my-1 -mr-1.5 flex shrink-0 gap-0.5">
          <ConfirmButton size="icon-sm" label="Remove" disabled={editing !== null || update.isPending} question="Remove this entry?" detail={`${agent.name} forgets it for good. This can't be undone.`} action="Remove"
            onConfirm={() => save({ target: entry.kind.target, list: memory[entry.kind.target].entries.filter((_, j) => j !== entry.index), done: () => {} })}>{ICONS.trash}</ConfirmButton>
        </span>}
      </div>)}
  </ItemGroup>
}

function FormActions({ onCancel, busy }: { onCancel: () => void; busy: boolean }) {
  return <div className="flex justify-end gap-2"><Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button><Button type="submit" variant="primary" size="sm" disabled={busy}>Save</Button></div>
}
