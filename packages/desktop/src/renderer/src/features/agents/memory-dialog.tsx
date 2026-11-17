import { useState } from 'react'
import { Delete02Icon, Note01Icon, PlusSignIcon, UserIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Memory, MemoryTarget } from '@openhut/common/agents/memory.ts'
import { Button } from '@/components/ui/button'
import { Meter } from '@/components/ui/meter'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNote } from '@/components/error-note'
import { Frame, I } from '@/components/kit'
import { useMemory, useUpdateMemory } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { formValues } from '@/lib/form'
import { toastError } from '@/lib/toast'

const KINDS: { target: MemoryTarget; label: string; one: string; icon: typeof UserIcon }[] = [
  { target: 'people', label: 'People', one: 'Person', icon: UserIcon },
  { target: 'notes', label: 'Notes', one: 'Note', icon: Note01Icon },
]
const LIST = 'flex flex-col rounded-lg border border-hair bg-card [&>*+*]:border-t [&>*+*]:border-hair'

export function MemoryDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const memory = useMemory(agent.id)
  const [adding, setAdding] = useState(false)
  const saved = memory.data ? KINDS.some((kind) => memory.data[kind.target].saved) : false
  return <Frame face={<Face agent={agent} size={40} />} onClose={onClose} title={`${agent.name}'s memory`} subtitle={`${agent.name} saves these itself as it works. Changes apply from its next conversation.`}
    action={<Button type="button" size="sm" variant="secondary" title={saved ? undefined : `${agent.name} hasn't saved any memory yet. You can add to it once it has.`} disabled={!agent.canEdit || adding || !saved} onClick={() => setAdding(true)}><I icon={PlusSignIcon} size={13} />Add</Button>}>
    <ErrorNote message={memory.error?.message} />
    {memory.data && <>
      <div className="flex gap-4 px-0.5">{KINDS.map((kind) => <span key={kind.target} className="inline-flex items-center gap-1.5 text-xs text-mute">
        {kind.label}<Meter size="xs" full={memory.data[kind.target].used >= memory.data[kind.target].limit} aria-label={`${kind.label} used`} min={0} max={memory.data[kind.target].limit} value={Math.min(memory.data[kind.target].used, memory.data[kind.target].limit)} />{Math.round(memory.data[kind.target].used / memory.data[kind.target].limit * 100)}% full
      </span>)}</div>
      <Entries agent={agent} memory={memory.data} adding={adding} onAdded={() => setAdding(false)} />
    </>}
  </Frame>
}

function Entries({ agent, memory, adding, onAdded }: { agent: Agent; memory: Memory; adding: boolean; onAdded: () => void }) {
  const update = useUpdateMemory(agent.id)
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const entries = KINDS.flatMap((kind) => memory[kind.target].entries.map((text, index) => ({ kind, text, index, key: `${kind.target}-${index}` })))
  const save = ({ target, list, done }: { target: MemoryTarget; list: string[]; done: () => void }) => update.mutate({ [target]: list }, { onSuccess: done, onError: toastError })
  return <div className={LIST}>
    {adding && <form className="flex animate-grow flex-col gap-2 p-3" onSubmit={(event) => {
      const value = formValues(event)
      const target = value('kind') === 'notes' ? 'notes' : 'people'
      save({ target, list: [...memory[target].entries, value('text')], done: onAdded })
    }}>
      <RadioGroup name="kind" variant="segmented" className="w-[200px]">{KINDS.map((kind) => <RadioGroupItem key={kind.target} value={kind.target} disabled={!memory[kind.target].saved}
        title={memory[kind.target].saved ? undefined : `${agent.name} hasn't saved any ${kind.label.toLowerCase()} yet`} defaultChecked={kind.target === KINDS.find((each) => memory[each.target].saved)?.target}><I icon={kind.icon} size={13} />{kind.one}</RadioGroupItem>)}</RadioGroup>
      <Textarea name="text" className="min-h-[76px]" aria-label="New memory entry" required autoFocus placeholder={`What should ${agent.name} remember?`} />
      <Actions onCancel={onAdded} busy={update.isPending} />
    </form>}
    {entries.map((entry) => {
      if (editing === entry.key) return <form key={entry.key} className="flex flex-col gap-2 p-3" onSubmit={(event) => save({ target: entry.kind.target, list: memory[entry.kind.target].entries.map((each, j) => j === entry.index ? formValues(event)('text') : each), done: () => setEditing(null) })}>
        <Textarea name="text" className="min-h-[76px]" aria-label="Memory entry" required autoFocus defaultValue={entry.text} />
        <Actions onCancel={() => setEditing(null)} busy={update.isPending} />
      </form>
      if (removing === entry.key) return <div key={entry.key} className="flex items-center gap-2 bg-[oklch(55%_.185_27/.04)] px-3.5 py-2.5 text-[13px]">
        <span className="flex-1">{agent.name} forgets it for good. This can't be undone.</span>
        <Button type="button" size="sm" variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button>
        <Button type="button" size="sm" variant="destructive" disabled={update.isPending} onClick={() => save({ target: entry.kind.target, list: memory[entry.kind.target].entries.filter((_, j) => j !== entry.index), done: () => setRemoving(null) })}>Remove</Button>
      </div>
      return <div key={entry.key} className="group flex items-start gap-3 px-3.5 py-2.5">
        <span className="pt-0.5 text-mute" title={entry.kind.one}><I icon={entry.kind.icon} size={15} /></span>
        <Button type="button" variant="bare" title={agent.canEdit ? 'Click to edit' : undefined} disabled={!agent.canEdit || editing !== null} onClick={() => setEditing(entry.key)}
          className="min-w-0 flex-1 cursor-text rounded-[4px] text-[13px]/[1.5] [overflow-wrap:anywhere] whitespace-pre-wrap text-ink not-disabled:hover:bg-tint disabled:cursor-default disabled:opacity-100">{entry.text}</Button>
        {agent.canEdit && <Button type="button" size="icon-xs" variant="danger" aria-label="Remove" className="-my-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => setRemoving(entry.key)}><I icon={Delete02Icon} size={14} /></Button>}
      </div>
    })}
    {!entries.length && !adding && <p className="m-0 px-4 py-3.5 text-[13px] text-mute">{agent.name} hasn't saved anything yet.</p>}
  </div>
}

function Actions({ onCancel, busy }: { onCancel: () => void; busy: boolean }) {
  return <div className="flex justify-end gap-2"><Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button><Button type="submit" variant="primary" size="sm" disabled={busy}>Save</Button></div>
}
