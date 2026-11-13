import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MODELS, SIZES, type Agent } from '@fastmonkey/common/agents/agent.ts'
import { Glyph } from '@/components/glyph'
import { ICONS, SIZE_ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { useUpdateAgent } from '@/features/agents/api'
import { toastError } from '@/lib/toast'

export function ModelPicker({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  return <Picker name="Model" options={MODELS} value={agent.model} iconOf={(_, size) => <Glyph name="claude" size={size} />} disabled={!agent.canEdit} lockReason={lockReason}
    onChoose={(model) => updateAgent.mutate({ model }, { onError: toastError })} />
}

export function SizePicker({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  return <Picker name="Computer" options={SIZES} value={agent.size} iconOf={(id) => SIZE_ICONS[id]} disabled={!agent.canEdit || updateAgent.isPending} lockReason={lockReason}
    note={`How much room ${agent.name} has to work. Changing it restarts ${agent.name}.`} onChoose={(size) => updateAgent.mutate({ size }, { onError: toastError })} />
}

function Picker<Id extends string>({ name, options, value, iconOf, note, disabled, lockReason, onChoose }: {
  name: string
  options: readonly { id: Id; label: string; blurb: string; spec?: string }[]
  value: Id
  iconOf: (id: Id, size: number) => ReactNode
  note?: string
  disabled: boolean
  lockReason: string | undefined
  onChoose: (id: Id) => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const current = options.find((option) => option.id === value)?.label ?? value

  useEffect(() => {
    if (!open) return
    list.current?.focus()
    const closeOutside = (event: MouseEvent) => { if (event.target instanceof Node && !box.current?.contains(event.target)) setOpen(false) }
    addEventListener('click', closeOutside)
    return () => removeEventListener('click', closeOutside)
  }, [open])

  const show = () => {
    setActive(Math.max(0, options.findIndex((option) => option.id === value)))
    setOpen(true)
  }
  const hide = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  const choose = (id: Id) => {
    hide()
    if (id !== value) onChoose(id)
  }
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown': setActive(Math.min(active + 1, options.length - 1)); break
      case 'ArrowUp': setActive(Math.max(active - 1, 0)); break
      case 'Home': setActive(0); break
      case 'End': setActive(options.length - 1); break
      case 'Enter': case ' ': choose(options[active].id); break
      case 'Escape': hide(); break
      case 'Tab': setOpen(false); return
      default: return
    }
    event.preventDefault()
  }

  return <Locked reason={lockReason}>
    <div ref={box} className="msel">
      <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={`${name}: ${current}. Change it`} disabled={disabled}
        onClick={() => open ? setOpen(false) : show()} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show() } }}>
        {iconOf(value, 14)}<span>{current}</span>{ICONS.chevd}
      </button>
      {open && <div ref={list} id={listId} className="mmenu" role="listbox" tabIndex={-1} aria-label={name} aria-activedescendant={`${listId}-${options[active].id}`} onKeyDown={onListKey}>
        {options.map((option, index) =>
          <div key={option.id} id={`${listId}-${option.id}`} role="option" aria-selected={option.id === value} className="mitem" data-active={index === active ? '' : undefined}
            onMouseEnter={() => setActive(index)} onClick={() => choose(option.id)}>
            {iconOf(option.id, 16)}<span className="t"><span className="mname">{option.label}{option.spec && <span className="mspec">{option.spec}</span>}</span><span className="mute">{option.blurb}</span></span><span className="mcheck">{option.id === value && ICONS.check}</span>
          </div>)}
        {note && <p className="mnote">{note}</p>}
      </div>}
    </div>
  </Locked>
}
