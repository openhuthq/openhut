import { useState, type ReactNode } from 'react'
import { Delete02Icon, Note01Icon, PlusSignIcon, UserIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Memory, MemoryTarget } from '@openhut/common/agents/memory.ts'
import { Button } from '@/components/ui/button'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { EmptyScene, SceneLoading } from '@/components/empty-art'
import { ErrorNote } from '@/components/error-note'
import { I, PILL } from '@/components/kit'
import { useMemory, useUpdateMemory } from '@/features/agents/api'
import type { Crumb } from '@/features/agents/skills-dialog'
import { formValues } from '@/lib/form'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const KINDS: { target: MemoryTarget; label: string; one: string; icon: typeof UserIcon }[] = [
  { target: 'people', label: 'People', one: 'Person', icon: UserIcon },
  { target: 'notes', label: 'Notes', one: 'Note', icon: Note01Icon },
]

type Entry = { kind: (typeof KINDS)[number]; text: string; index: number; key: string }

export function MemoryEditor({ agent, head }: { agent: Agent; head: (crumb?: Crumb) => ReactNode }) {
  const memory = useMemory(agent.id)
  return <>
    {!memory.data && <>{head()}<div className="mb-1.5 min-h-[26px]" /></>}
    <ErrorNote message={memory.error?.message} />
    {!memory.data && !memory.error && <SceneLoading />}
    {memory.data && <Entries agent={{ ...agent, canEdit: agent.canEdit && agent.runsHere }} memory={memory.data} head={head} />}
  </>
}

function Entries({ agent, memory, head }: { agent: Agent; memory: Memory; head: (crumb?: Crumb) => ReactNode }) {
  const update = useUpdateMemory(agent.id)
  const [picked, setPicked] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(false)
  const all: Entry[] = KINDS.flatMap((kind) => memory[kind.target].entries.map((text, index) => ({ kind, text, index, key: `${kind.target}-${index}` })))
  const selected = adding ? undefined : all.find((entry) => entry.key === picked)
  const saved = KINDS.some((kind) => memory[kind.target].saved)
  const back = () => { setPicked(null); setAdding(false); setRemoving(false) }
  const save = ({ target, list, done }: { target: MemoryTarget; list: string[]; done: () => void }) => update.mutate({ [target]: list }, { onSuccess: done, onError: toastError })
  if (adding) return <form className="flex min-h-0 flex-1 flex-col pr-8" onSubmit={(event) => {
    const value = formValues(event)
    const target = value('kind') === 'notes' ? 'notes' : 'people'
    save({ target, list: [...memory[target].entries, value('text')], done: back })
  }}>
    {head({ label: 'New', onBack: back })}
    <RadioGroup name="kind" variant="segmented" className="mb-3 w-[200px]">{KINDS.map((kind) => <RadioGroupItem key={kind.target} value={kind.target} disabled={!memory[kind.target].saved}
      defaultChecked={kind.target === KINDS.find((each) => memory[each.target].saved)?.target}><I icon={kind.icon} size={13} />{kind.one}</RadioGroupItem>)}</RadioGroup>
    <Textarea name="text" className="min-h-[160px] flex-1 resize-none text-[14px]/[1.6]" aria-label="New memory entry" required autoFocus placeholder={`What should ${agent.name} remember?`} />
    <Foot><span className="ml-auto flex gap-2"><Button type="button" variant="secondary" onClick={back}>Cancel</Button><Button type="submit" variant="primary" disabled={update.isPending}>Save</Button></span></Foot>
  </form>
  if (selected) return <form key={`${selected.key}:${selected.text}`} className="flex min-h-0 flex-1 flex-col pr-8"
    onSubmit={(event) => save({ target: selected.kind.target, list: memory[selected.kind.target].entries.map((each, j) => j === selected.index ? formValues(event)('text') : each), done: back })}>
    {head({ label: selected.kind.one, onBack: back })}
    <Textarea name="text" className="min-h-[160px] flex-1 resize-none text-[14px]/[1.6]" aria-label="Memory entry" required readOnly={!agent.canEdit} defaultValue={selected.text} />
    {agent.canEdit && <Foot>
      {removing
        ? <><span className="text-[13px]">{agent.name} forgets it for good.</span>
          <Button type="button" variant="destructive" size="sm" disabled={update.isPending} onClick={() => save({ target: selected.kind.target, list: memory[selected.kind.target].entries.filter((_, j) => j !== selected.index), done: back })}>Remove</Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => setRemoving(false)}>Cancel</Button></>
        : <Button type="button" variant="danger" onClick={() => setRemoving(true)}><I icon={Delete02Icon} size={14} />Remove</Button>}
      <span className="ml-auto flex gap-2"><Button type="reset" variant="secondary">Discard</Button><Button type="submit" variant="primary" disabled={update.isPending}>Save</Button></span>
    </Foot>}
  </form>
  return <>
    {head()}
    {!agent.runsHere && <p className="m-0 mb-2 text-[13px] text-mute">On another computer. Run the agent here to change it.</p>}
    <div className="mb-1.5 flex min-h-[26px] items-center pr-8 text-[12px]/[16px] text-mute">{all.length === 1 ? '1 note' : `${all.length} notes`}
      {agent.canEdit && saved && <Button type="button" variant="primary" className={cn(PILL, 'ml-auto gap-1')} onClick={() => { setAdding(true); setRemoving(false) }}><I icon={PlusSignIcon} size={14} />Add</Button>}
    </div>
    {!all.length && <EmptyScene kind="memory" title="Nothing saved yet" line={`${agent.name} saves what it learns about you and your work here.`} />}
    {all.length > 0 && <div className="no-scrollbar -ml-2.5 flex min-h-0 flex-1 flex-col overflow-y-auto pr-8">
      {all.map((entry) => <Button key={entry.key} type="button" variant="bare" onClick={() => setPicked(entry.key)}
        className="flex h-[42px] w-full shrink-0 items-center gap-3 rounded-md px-2.5 text-left text-[13.5px] text-ink hover:bg-hover">
        <I icon={entry.kind.icon} size={15} className="shrink-0 text-mute" /><span className="min-w-0 truncate">{entry.text}</span>
      </Button>)}
    </div>}
  </>
}

function Foot({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex items-center gap-2">{children}</div>
}
