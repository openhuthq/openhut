import type { ReactNode } from 'react'
import { Select, SelectContent, SelectFooter, SelectItem, SelectTrigger } from '@/components/ui/select'
import { ICONS } from '@/components/icons'
import { Locked } from '@/components/locked'
import { cn } from '@/lib/utils'

export function Picker<Id extends string>({ name, options, value, iconOf, note, disabled, lockReason, onChoose, formName, className, triggerClassName }: {
  name: string
  options: readonly { id: Id; label: string; blurb: string; spec?: string }[]
  value: Id
  iconOf: (id: Id, size: number) => ReactNode
  note?: string
  disabled: boolean
  lockReason: string | undefined
  onChoose: (id: Id) => void
  formName?: string
  className?: string
  triggerClassName?: string
}) {
  const current = options.find((option) => option.id === value)?.label ?? value
  return <Locked reason={lockReason}>
    <div className={cn('relative', className)}>
      <Select<Id> value={value} name={formName} disabled={disabled} onValueChange={(id) => { if (id !== null && id !== value) onChoose(id) }}>
        <SelectTrigger aria-label={`${name}: ${current}. Change it`} className={triggerClassName}>{iconOf(value, 14)}<span>{current}</span>{ICONS.chevd}</SelectTrigger>
        <SelectContent aria-label={name}>
          {options.map((option) => <SelectItem key={option.id} value={option.id}>
            {iconOf(option.id, 16)}
            <span className="flex min-w-0 flex-1 flex-col"><span className="flex items-baseline justify-between gap-2 text-sm font-medium">{option.label}{option.spec && <span className="font-mono text-[11px] font-normal whitespace-nowrap text-mute">{option.spec}</span>}</span><span className="text-xs text-mute">{option.blurb}</span></span>
            <span className="inline-flex w-3.5 justify-center text-primary">{option.id === value && ICONS.check}</span>
          </SelectItem>)}
          {note && <SelectFooter>{note}</SelectFooter>}
        </SelectContent>
      </Select>
    </div>
  </Locked>
}
