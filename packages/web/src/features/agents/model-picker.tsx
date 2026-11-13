import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { MODELS, type Agent, type ModelId } from '@jakebox/common/agents/agent.ts'
import { Glyph } from '@/components/glyph'
import { ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { useUpdateAgent } from '@/features/agents/api'
import { modelLabel } from '@/features/agents/model-label'
import { toastError } from '@/lib/toast'

export function ModelPicker({ agent, lockReason }: { agent: Agent; lockReason: string | undefined }) {
  const updateAgent = useUpdateAgent(agent.id)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const current = modelLabel(agent.model)

  useEffect(() => {
    if (!open) return
    list.current?.focus()
    const closeOutside = (event: MouseEvent) => { if (event.target instanceof Node && !box.current?.contains(event.target)) setOpen(false) }
    addEventListener('click', closeOutside)
    return () => removeEventListener('click', closeOutside)
  }, [open])

  const show = () => {
    setActive(Math.max(0, MODELS.findIndex((model) => model.id === agent.model)))
    setOpen(true)
  }
  const hide = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  const choose = (model: ModelId) => {
    hide()
    if (model !== agent.model) updateAgent.mutate({ model }, { onError: toastError })
  }
  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'ArrowDown': setActive(Math.min(active + 1, MODELS.length - 1)); break
      case 'ArrowUp': setActive(Math.max(active - 1, 0)); break
      case 'Home': setActive(0); break
      case 'End': setActive(MODELS.length - 1); break
      case 'Enter': case ' ': choose(MODELS[active].id); break
      case 'Escape': hide(); break
      case 'Tab': setOpen(false); return
      default: return
    }
    event.preventDefault()
  }

  return <Locked reason={lockReason}>
    <div ref={box} className="msel">
      <button ref={trigger} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-label={`Model: ${current}. Change it`} disabled={!agent.canEdit}
        onClick={() => open ? setOpen(false) : show()} onKeyDown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show() } }}>
        <Glyph name="claude" size={14} /><span>{current}</span>{ICONS.chevd}
      </button>
      {open && <div ref={list} id={listId} className="mmenu" role="listbox" tabIndex={-1} aria-label="Model" aria-activedescendant={`${listId}-${MODELS[active].id}`} onKeyDown={onListKey}>
        {MODELS.map((model, index) =>
          <div key={model.id} id={`${listId}-${model.id}`} role="option" aria-selected={model.id === agent.model} className="mitem" data-active={index === active ? '' : undefined}
            onMouseEnter={() => setActive(index)} onClick={() => choose(model.id)}>
            <Glyph name="claude" size={16} /><span className="t"><span className="mname">{model.label}</span><span className="mute">{model.blurb}</span></span><span className="mcheck">{model.id === agent.model && ICONS.check}</span>
          </div>)}
      </div>}
    </div>
  </Locked>
}
