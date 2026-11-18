import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { SparklesIcon, Search01Icon, Tick02Icon, UnfoldMoreIcon } from '@hugeicons/core-free-icons'
import { PROVIDERS, type Provider } from '@openhut/common/models/provider.ts'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Glyph } from '@/components/glyph'
import { I } from '@/components/kit'
import { BRAND, describe, find, matches } from '@/features/models/labels'
import { cn } from '@/lib/utils'

const SEARCH_FROM = 8
const OPTION = 'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-tint aria-selected:bg-tint aria-disabled:cursor-default aria-disabled:text-mute-2 aria-disabled:hover:bg-transparent'

export const SOFT_TRIGGER = cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'min-w-[136px] max-w-full justify-between')

export type PickerNone = { name: string; note: string; icon: ReactNode }

export function ModelPicker({ providers, value, onPick, title, label, none, exclude, disabled, className, children }: {
  providers: Provider[] | undefined
  value: string | null
  onPick: (key: string | null) => void
  title: string
  label: string
  none?: PickerNone
  exclude?: string | null
  disabled?: boolean
  className?: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const connected = PROVIDERS.flatMap((info) => providers?.find((each) => each.id === info.id && each.connected) ?? [])
  const total = connected.reduce((sum, provider) => sum + provider.models.filter((model) => model.on).length, 0)
  const searching = query.trim().length > 0
  const groups = connected.map((provider) => ({ provider, models: provider.models.filter((model) => model.on && matches({ model, query })) })).filter((group) => group.models.length)
  const missing = PROVIDERS.filter((info) => !connected.some((provider) => provider.id === info.id))
  const choose = (key: string | null) => {
    setOpen(false)
    onPick(key)
  }
  const move = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement && event.key !== 'ArrowDown') return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role=option]:not([aria-disabled=true])')]
    const at = options.indexOf(document.activeElement instanceof HTMLElement ? document.activeElement : event.currentTarget)
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1
    options[Math.min(Math.max(next, 0), options.length - 1)]?.focus()
  }
  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery('') }}>
    <PopoverTrigger className={className ?? SOFT_TRIGGER} disabled={disabled} aria-label={`${label}: ${find({ providers, key: value }).model?.name ?? value ?? none?.name ?? 'None'}`}>
      {children ?? <ModelValue providers={providers} value={value} none={none} />}
    </PopoverTrigger>
    <PopoverContent align="end" className="max-h-[min(420px,var(--available-height))] w-[320px] gap-0 overflow-hidden rounded-lg p-1.5" onKeyDown={move}>
      <div className="px-2 pt-1 pb-1.5 text-[12px] text-mute">{title}</div>
      {total > SEARCH_FROM && <div className="relative mx-0.5 mb-1.5">
        <I icon={Search01Icon} size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-mute" />
        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" autoComplete="off" aria-label="Search models" className="h-[30px] rounded-lg border-0 bg-soft pr-2.5 pl-7 text-[13px]" />
      </div>}
      <div role="listbox" aria-label={title} className="no-scrollbar flex min-h-0 flex-col overflow-auto">
        {none && !searching && <Option icon={none.icon} name={none.name} note={none.note} selected={value === null} onClick={() => choose(null)} />}
        {groups.map(({ provider, models }) => <div key={provider.id} className="flex flex-col">
          <div className="flex items-center gap-1.5 px-2 pt-2 pb-1 text-[12px] text-mute"><Glyph name={BRAND[provider.id]} size={12} />{provider.name}</div>
          {models.map((model) => {
            const key = `${provider.id}:${model.id}`
            const same = exclude === key
            return <Option key={key} icon={<Glyph name={BRAND[provider.id]} size={14} />} name={model.name} note={same ? 'Already its main model' : describe({ provider, model })} selected={value === key} disabled={same} onClick={() => choose(key)} />
          })}
        </div>)}
        {searching && !groups.length && <p className="m-0 px-2 py-3 text-[13px] text-mute">No model matches “{query.trim()}”.</p>}
        {!searching && missing.length > 0 && <div className="flex flex-col">
          <div className="px-2 pt-2 pb-1 text-[12px] text-mute">Not set up</div>
          {missing.map((info) => <Option key={info.id} icon={<Glyph name={BRAND[info.id]} size={14} />} name={info.name} note={info.kind === 'subscription' ? 'Sign in under Settings, Models' : 'Add a key under Settings, Models'} disabled />)}
        </div>}
      </div>
    </PopoverContent>
  </Popover>
}

export function ModelValue({ providers, value, none }: { providers: Provider[] | undefined; value: string | null; none?: PickerNone }) {
  const { split, model } = find({ providers, key: value })
  if (!split) return <>
    <span className="grid w-3.5 shrink-0 place-items-center">{none?.icon}</span>
    <span className="min-w-0 flex-1 truncate text-left font-normal text-mute">{none?.name ?? 'Choose a model'}</span>
    <I icon={UnfoldMoreIcon} size={12} className="text-mute" />
  </>
  return <>
    <span className="grid w-3.5 shrink-0 place-items-center"><Glyph name={BRAND[split.provider]} size={14} /></span>
    <span className="min-w-0 flex-1 truncate text-left">{model?.name ?? split.model}</span>
    <I icon={UnfoldMoreIcon} size={12} className="text-mute" />
  </>
}

export const SPARKLE = <I icon={SparklesIcon} size={14} />

function Option({ icon, name, note, selected = false, disabled = false, onClick }: { icon: ReactNode; name: string; note: string; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  return <Button type="button" variant="bare" role="option" aria-selected={selected} aria-disabled={disabled} tabIndex={-1} onClick={disabled ? undefined : onClick} className={OPTION}>
    <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg bg-soft text-ink', disabled && 'opacity-60')}>{icon}</span>
    <span className="grid min-w-0 flex-1 leading-tight"><span className="text-[13px] font-medium">{name}</span><span className="truncate text-[11.5px] text-mute" title={note}>{note}</span></span>
    {selected && <I icon={Tick02Icon} size={14} />}
  </Button>
}
