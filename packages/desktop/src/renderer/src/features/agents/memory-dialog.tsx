import { useState, type ReactNode } from 'react'
import { ArrowLeft01Icon, Cancel01Icon, Delete02Icon, Note01Icon, PlusSignIcon, UserIcon } from '@hugeicons/core-free-icons'
import type { Agent } from '@openhut/common/agents/agent.ts'
import type { Memory, MemoryTarget } from '@openhut/common/agents/memory.ts'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmButton } from '@/components/confirm-button'
import { ErrorNote } from '@/components/error-note'
import { DialogCard, I, Loading, SPLIT_DIALOG } from '@/components/kit'
import { useMemory, useUpdateMemory } from '@/features/agents/api'
import { Face } from '@/features/agents/face'
import { formValues } from '@/lib/form'
import { PHONE, useMedia } from '@/lib/media'
import { toastError } from '@/lib/toast'
import { cn } from '@/lib/utils'

const KINDS: { target: MemoryTarget; label: string; one: string; icon: typeof UserIcon }[] = [
  { target: 'people', label: 'People', one: 'Person', icon: UserIcon },
  { target: 'notes', label: 'Notes', one: 'Note', icon: Note01Icon },
]

type Entry = { kind: (typeof KINDS)[number]; text: string; index: number; key: string }

export function MemoryDialog({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const memory = useMemory(agent.id)
  return <DialogCard onClose={onClose} className={cn(SPLIT_DIALOG, 'flex-col')}>
    <div className="flex items-start gap-3 border-b border-hair px-5 pt-5 pb-4">
      <Face agent={agent} size={40} />
      <div className="grid min-w-0 flex-1 gap-1"><DialogTitle className="text-[15px]/[22px] font-medium">{agent.name}'s memory</DialogTitle><p className="m-0 text-[13px]/[18px] text-body">{agent.runsHere ? `${agent.name} saves these itself as it works. Changes apply from its next conversation.` : 'Runs on your other computer.'}</p></div>
      <Button type="button" size="icon-sm" aria-label="Close" title="Close" tabIndex={-1} className="-mt-1 -mr-1" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    </div>
    <ErrorNote className="mx-5 mt-3" message={memory.error?.message} />
    {!memory.data && !memory.error && <Loading />}
    {memory.data && <Entries agent={{ ...agent, canEdit: agent.canEdit && agent.runsHere }} memory={memory.data} />}
  </DialogCard>
}

function Entries({ agent, memory }: { agent: Agent; memory: Memory }) {
  const update = useUpdateMemory(agent.id)
  const [picked, setPicked] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState(false)
  const all: Entry[] = KINDS.flatMap((kind) => memory[kind.target].entries.map((text, index) => ({ kind, text, index, key: `${kind.target}-${index}` })))
  const phone = useMedia(PHONE)
  const selected = adding ? undefined : all.find((entry) => entry.key === picked) ?? (phone ? undefined : all[0])
  const open = adding || !!selected
  const saved = KINDS.some((kind) => memory[kind.target].saved)
  const pick = (key: string) => { setPicked(key); setAdding(false); setRemoving(false) }
  const save = ({ target, list, done }: { target: MemoryTarget; list: string[]; done: () => void }) => update.mutate({ [target]: list }, { onSuccess: done, onError: toastError })
  return <div className="flex min-h-0 flex-1 phone:flex-col">
    <aside className={cn('flex w-[340px] shrink-0 flex-col gap-3 border-r border-hair bg-sidebar p-4 phone:w-full phone:flex-1 phone:border-r-0', open ? 'phone:hidden' : 'phone:animate-[levelback_.3s_cubic-bezier(.22,1,.36,1)]')}>
      <div className="flex gap-2">
        <Button type="button" variant="secondary" title={saved ? undefined : `${agent.name} hasn't saved any memory yet. You can add to it once it has.`} disabled={!agent.canEdit || adding || !saved} onClick={() => { setAdding(true); setRemoving(false) }}><I icon={PlusSignIcon} size={13} />Add</Button>
      </div>
      <nav aria-label="Memory entries" className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-auto px-1">
        {KINDS.map((kind) => {
          const entries = all.filter((entry) => entry.kind === kind)
          return <section key={kind.target} className="flex flex-col gap-0.5 not-first:mt-3">
            <h3 className="m-0 flex items-center gap-1.5 px-2 pb-1 text-[12px] font-medium text-mute"><I icon={kind.icon} size={13} />{kind.label}<span className="font-mono">{entries.length}</span></h3>
            {entries.map((entry) => <Button key={entry.key} type="button" variant="bare" aria-current={entry.key === selected?.key || undefined} onClick={() => pick(entry.key)}
              className="rounded-lg px-2 py-1.5 text-left text-[13px]/[1.45] text-ink hover:bg-soft aria-[current]:bg-hair">
              <span className="line-clamp-2 [overflow-wrap:anywhere]">{entry.text}</span>
            </Button>)}
            {!entries.length && <p className="m-0 px-2 text-[13px] text-mute">Nothing saved yet.</p>}
          </section>
        })}
      </nav>
    </aside>
    <section className={cn('flex min-w-0 flex-1 flex-col', open ? 'phone:animate-[levelin_.3s_cubic-bezier(.22,1,.36,1)]' : 'phone:hidden')}>
      {phone && open && <Button type="button" data-back variant="bare" className="mx-3 mt-3 -mb-2 inline-flex w-fit items-center gap-1 px-1 text-mute" onClick={() => { setPicked(null); setAdding(false); setRemoving(false) }}><I icon={ArrowLeft01Icon} size={15} />All memory</Button>}
      {adding && <form className="flex flex-1 flex-col" onSubmit={(event) => {
        const value = formValues(event)
        const target = value('kind') === 'notes' ? 'notes' : 'people'
        save({ target, list: [...memory[target].entries, value('text')], done: () => { setAdding(false); setPicked(`${target}-${memory[target].entries.length}`) } })
      }}>
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-5">
          <RadioGroup name="kind" variant="segmented" className="w-[200px]">{KINDS.map((kind) => <RadioGroupItem key={kind.target} value={kind.target} disabled={!memory[kind.target].saved}
            title={memory[kind.target].saved ? undefined : `${agent.name} hasn't saved any ${kind.label.toLowerCase()} yet`} defaultChecked={kind.target === KINDS.find((each) => memory[each.target].saved)?.target}><I icon={kind.icon} size={13} />{kind.one}</RadioGroupItem>)}</RadioGroup>
          <Textarea name="text" className="min-h-0 flex-1 resize-none text-[15px]/[1.6]" aria-label="New memory entry" required autoFocus placeholder={`What should ${agent.name} remember?`} />
        </div>
        <Foot><span className="ml-auto flex gap-2"><Button type="button" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={update.isPending}>Save</Button></span></Foot>
      </form>}
      {selected && <form key={`${selected.key}:${selected.text}`} className="flex flex-1 flex-col"
        onSubmit={(event) => save({ target: selected.kind.target, list: memory[selected.kind.target].entries.map((each, j) => j === selected.index ? formValues(event)('text') : each), done: () => undefined })}>
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-5">
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-mute"><I icon={selected.kind.icon} size={13} />{selected.kind.one}</span>
          <Textarea name="text" className="min-h-0 flex-1 resize-none text-[15px]/[1.6]" aria-label="Memory entry" required readOnly={!agent.canEdit} defaultValue={selected.text} />
        </div>
        {agent.canEdit && <Foot>
          {phone ? <ConfirmButton question={`Remove this ${selected.kind.one.toLowerCase()}?`} detail={`${agent.name} forgets it for good. This can't be undone.`} action="Remove"
            onConfirm={() => save({ target: selected.kind.target, list: memory[selected.kind.target].entries.filter((_, j) => j !== selected.index), done: () => setPicked(null) })}><I icon={Delete02Icon} size={14} />Remove</ConfirmButton> : removing
            ? <><span className="text-[13px]">{agent.name} forgets it for good. This can't be undone.</span>
              <Button type="button" variant="destructive" size="sm" disabled={update.isPending} onClick={() => save({ target: selected.kind.target, list: memory[selected.kind.target].entries.filter((_, j) => j !== selected.index), done: () => { setRemoving(false); setPicked(null) } })}>Remove</Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setRemoving(false)}>Keep it</Button></>
            : <Button type="button" variant="danger" onClick={() => setRemoving(true)}><I icon={Delete02Icon} size={14} />Remove</Button>}
          <span className="ml-auto flex gap-2"><Button type="reset" variant="secondary">Revert</Button><Button type="submit" variant="primary" disabled={update.isPending}>Save</Button></span>
        </Foot>}
      </form>}
      {!adding && !selected && !phone && <p className="m-0 p-5 text-[13px] text-mute">{agent.name} hasn't saved anything yet.</p>}
    </section>
  </div>
}

function Foot({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 border-t border-hair px-5 py-3">{children}</div>
}
