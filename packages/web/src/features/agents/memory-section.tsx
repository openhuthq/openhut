import { useState } from 'react'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Memory, MemoryTarget } from '@openhut/common/agents/memory.ts'
import { ConfirmButton } from '@/components/confirm-button'
import { Dialog } from '@/components/dialog'
import { DialogHead } from '@/components/dialog-head'
import { ErrorNote } from '@/components/error-note'
import { AUTOMATION_ICONS, FACT_ICONS, ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { useMemory, useUpdateMemory } from '@/features/agents/api'
import { formValues } from '@/lib/form'
import { navigate } from '@/lib/router'
import { toastError } from '@/lib/toast'

const KINDS: { target: MemoryTarget; label: string; icon: keyof typeof AUTOMATION_ICONS }[] = [
  { target: 'people', label: 'People', icon: 'person' },
  { target: 'notes', label: 'Notes', icon: 'note' },
]

export function MemoryRow({ agent }: { agent: Agent }) {
  const memory = useMemory(agent.id)
  const count = memory.data ? memory.data.notes.entries.length + memory.data.people.entries.length : undefined
  return <div>
    <span>{FACT_ICONS.memory}Memory</span>
    <button type="button" className="btn sec sm" onClick={() => navigate(`/agents/${agent.id}/memory`)}>{count === undefined ? 'Manage' : `${entriesLabel(count)} · Manage`}</button>
  </div>
}

function entriesLabel(count: number): string {
  return count === 1 ? '1 entry' : `${count} entries`
}

export function MemorySheet({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const memory = useMemory(agent.id)
  const [adding, setAdding] = useState(false)
  return <Dialog className="dlg sheet" labelledBy="mem-h" onClosed={() => navigate(`/agents/${agent.id}`)}>{(close) =>
    <div className="dlgform">
      <DialogHead id="mem-h" title={`${agent.name}'s memory`} subtitle={`${agent.name} saves these itself as it works. Changes apply from its next conversation.`} onClose={close} />
      <div className="dlgbody">
        <ErrorNote message={memory.error?.message} />
        {memory.data && <>
          <div className="shead flush">
            <span className="mtrs">{KINDS.map((kind) => <Meter key={kind.target} label={kind.label} used={memory.data[kind.target].used} limit={memory.data[kind.target].limit} />)}</span>
            <Locked reason={lockReason ?? (KINDS.some((kind) => memory.data[kind.target].saved) ? undefined : `${agent.name} hasn't saved any memory yet. You can add to it once it has.`)}>
              <button type="button" className="btn sm" disabled={!agent.canEdit || adding || !KINDS.some((kind) => memory.data[kind.target].saved)} onClick={() => setAdding(true)}>{ICONS.plus}Add</button>
            </Locked>
          </div>
          <MemoryList agent={agent} memory={memory.data} adding={adding} onAdded={() => setAdding(false)} />
        </>}
      </div>
    </div>}
  </Dialog>
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const full = used >= limit
  return <span className="mtr">
    <span className="mute">{label}</span>
    <span className={full ? 'memuse full' : 'memuse'} role="meter" aria-label={`${label} used`} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}><i style={{ width: `${Math.min(100, used / limit * 100)}%` }}></i></span>
    <span className="mute num">{Math.round(used / limit * 100)}% full</span>
  </span>
}

function MemoryList({ agent, memory, adding, onAdded }: { agent: Agent; memory: Memory; adding: boolean; onAdded: () => void }) {
  const update = useUpdateMemory(agent.id)
  const [editing, setEditing] = useState<string | null>(null)
  const entries = KINDS.flatMap((kind) => memory[kind.target].entries.map((text, index) => ({ kind, text, index, key: `${kind.target}-${index}` })))
  const save = ({ target, list, done }: { target: MemoryTarget; list: string[]; done: () => void }) => update.mutate({ [target]: list }, { onSuccess: done, onError: toastError })
  return <div className="box rows">
    {adding && <form className="memform" onSubmit={(event) => {
      const value = formValues(event)
      const target = value('kind') === 'notes' ? 'notes' : 'people'
      save({ target, list: [...memory[target].entries, value('text')], done: onAdded })
    }}>
      <div className="setup-seg narrow-seg">{KINDS.map((kind) => <label key={kind.target} title={memory[kind.target].saved ? undefined : `${agent.name} hasn't saved any ${kind.label.toLowerCase()} yet`}>
        <input type="radio" name="kind" value={kind.target} disabled={!memory[kind.target].saved} defaultChecked={kind.target === KINDS.find((each) => memory[each.target].saved)?.target} />{AUTOMATION_ICONS[kind.icon]}{kind.label === 'People' ? 'Person' : 'Note'}
      </label>)}</div>
      <textarea name="text" aria-label="New memory entry" required autoFocus placeholder={`What should ${agent.name} remember?`} />
      <div className="acts"><button type="button" className="btn sec sm" onClick={onAdded}>Cancel</button><button className="btn primary sm" disabled={update.isPending}>Save</button></div>
    </form>}
    {!entries.length && !adding && <p className="note mempad">{agent.name} hasn't saved anything yet.</p>}
    {entries.map((entry) => editing === entry.key
      ? <form key={entry.key} className="memform" onSubmit={(event) => save({ target: entry.kind.target, list: memory[entry.kind.target].entries.map((each, j) => j === entry.index ? formValues(event)('text') : each), done: () => setEditing(null) })}>
        <textarea name="text" aria-label="Memory entry" required autoFocus defaultValue={entry.text} />
        <div className="acts"><button type="button" className="btn sec sm" onClick={() => setEditing(null)}>Cancel</button><button className="btn primary sm" disabled={update.isPending}>Save</button></div>
      </form>
      : <div className="row mementry" key={entry.key}>
        <span className="mkind" title={entry.kind.label}>{AUTOMATION_ICONS[entry.kind.icon]}</span>
        {agent.canEdit
          ? <button type="button" className="memtext editable" title="Click to edit" disabled={editing !== null} onClick={() => setEditing(entry.key)}>{entry.text}</button>
          : <p className="memtext">{entry.text}</p>}
        {agent.canEdit && <span className="rowacts">
          <ConfirmButton className="btn icon sm danger" label="Remove" disabled={editing !== null || update.isPending} question="Remove this entry?" detail={`${agent.name} forgets it for good. This can't be undone.`} action="Remove"
            onConfirm={() => save({ target: entry.kind.target, list: memory[entry.kind.target].entries.filter((_, j) => j !== entry.index), done: () => {} })}>{ICONS.trash}</ConfirmButton>
        </span>}
      </div>)}
  </div>
}
