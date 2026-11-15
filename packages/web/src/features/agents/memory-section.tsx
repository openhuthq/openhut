import { useState } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Memory, MemoryTarget } from '@openhut/common/agents/memory.ts'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { SectionHead } from '@/components/section-head'
import { useMemory, useUpdateMemory } from '@/features/agents/api'
import { formValues } from '@/lib/form'
import { toastError } from '@/lib/toast'

const BLOCKS: { target: MemoryTarget; title: string; empty: (name: string) => string }[] = [
  { target: 'notes', title: 'Notes', empty: (name) => `${name} hasn't saved any notes yet.` },
  { target: 'people', title: 'About people', empty: (name) => `${name} hasn't saved anything about people yet.` },
]

export function MemorySection({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const memory = useMemory(agent.id)
  return <section>
    <SectionHead title="Memory" />
    <ErrorNote message={memory.error?.message} />
    {memory.data && <div className="memory">
      {BLOCKS.map((block) => <MemoryBlock key={block.target} agent={agent} memory={memory.data} lockReason={lockReason} {...block} />)}
    </div>}
    <p className="note">{agent.name} writes these itself as it works. Changes here apply from its next conversation.</p>
  </section>
}

function MemoryBlock({ agent, memory, target, title, empty, lockReason }: {
  agent: Agent
  memory: Memory
  target: MemoryTarget
  title: string
  empty: (name: string) => string
  lockReason: string | undefined
}) {
  const block = memory[target]
  const updateMemory = useUpdateMemory(agent.id)
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const editable = agent.canEdit && block.saved
  const save = (entries: string[]) => updateMemory.mutate({ [target]: entries }, { onSuccess: () => setEditing(null), onError: toastError })
  const full = block.used >= block.limit
  return <div className="box memblock">
    <div className="memhead">
      <b>{title}</b>
      <span className={full ? 'memuse full' : 'memuse'} role="meter" aria-label={`${title} used`} aria-valuemin={0} aria-valuemax={block.limit} aria-valuenow={block.used}><i style={{ width: `${Math.min(100, block.used / block.limit * 100)}%` }}></i></span>
      <span className="mute num">{block.used.toLocaleString('en')} / {block.limit.toLocaleString('en')}</span>
      {block.saved && <Locked reason={lockReason}>
        <button type="button" className="btn sm" disabled={!editable || editing !== null} onClick={() => setEditing('new')}>{ICONS.plus}Add</button>
      </Locked>}
    </div>
    <div className="rows">
      {!block.entries.length && editing !== 'new' && <p className="note mempad">{empty(agent.name)}</p>}
      {block.entries.map((entry, i) => editing === i
        ? <EntryForm key={i} initial={entry} busy={updateMemory.isPending} onCancel={() => setEditing(null)} onSave={(text) => save(block.entries.map((each, j) => j === i ? text : each))} />
        : <div className="row mementry" key={i}>
          <p>{entry}</p>
          {editable && <span className="rowacts">
            <button type="button" className="btn icon sm" title="Edit" aria-label="Edit this entry" disabled={editing !== null} onClick={() => setEditing(i)}>{ICONS.pencil}</button>
            <ConfirmButton className="btn icon sm danger" label="Remove" disabled={editing !== null || updateMemory.isPending} question="Remove this entry?" detail={`${agent.name} forgets it for good. This can't be undone.`} action="Remove"
              onConfirm={() => save(block.entries.filter((_, j) => j !== i))}>{ICONS.trash}</ConfirmButton>
          </span>}
        </div>)}
      {editing === 'new' && <EntryForm initial="" busy={updateMemory.isPending} onCancel={() => setEditing(null)} onSave={(text) => save([...block.entries, text])} />}
    </div>
  </div>
}

function EntryForm({ initial, busy, onSave, onCancel }: { initial: string; busy: boolean; onSave: (text: string) => void; onCancel: () => void }) {
  return <form className="memform" onSubmit={(event) => onSave(formValues(event)('text'))}>
    <textarea name="text" aria-label="Memory entry" required autoFocus defaultValue={initial} />
    <div className="acts">
      <button type="button" className="btn sec sm" onClick={onCancel}>Cancel</button>
      <button className="btn primary sm" disabled={busy}>Save</button>
    </div>
  </form>
}
