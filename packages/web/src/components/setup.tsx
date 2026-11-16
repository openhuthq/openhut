import type { ReactNode } from 'react'
import type { BrandName } from '@/components/brand-icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Alert } from '@/components/ui/alert'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ICONS, SETUP_ICONS, type SetupIcon } from '@/components/icons'
import { Locked } from '@/components/locked'
import { Mark } from '@/components/mark'
import { cn } from '@/lib/utils'

export type SetupInfo = { brand: BrandName; title: string; blurb: string; chips: [SetupIcon, string][]; safe: string; warn?: string; eta: string; details?: string[] }

export function SetupDialog({ info, onClose, children }: { info: SetupInfo; onClose: () => void; children: ReactNode }) {
  return <Dialog size="setup" onClose={onClose}><div className="flex max-h-[min(88vh,820px)] flex-col overflow-auto">
    <div className="flex items-center gap-3.5 pt-5 pr-4 pb-3.5 pl-5">
      <Mark name={info.brand} size={48} variant="setup" />
      <div className="min-w-0 flex-1"><DialogTitle className="text-[17px] font-semibold tracking-[-.01em]">{info.title}</DialogTitle><DialogDescription className="mt-0.5 text-sm">{info.blurb}</DialogDescription></div>
      <Button type="button" size="icon-sm" className="self-start" onClick={onClose} aria-label="Close" title="Close">{ICONS.x}</Button>
    </div>
    <div className="flex flex-wrap gap-1.5 px-5 pb-4">{info.chips.map(([icon, label]) => <Badge variant="chip" key={label}>{SETUP_ICONS[icon]}{label}</Badge>)}</div>
    {children}
  </div></Dialog>
}

export function SetupSteps({ children }: { children: ReactNode }) {
  return <div className="flex flex-col border-t border-hair px-5 py-[18px]">{children}</div>
}

const STEP_NUMBER = { next: 'bg-card text-mute shadow-[inset_0_0_0_1.5px_var(--mid)]', now: 'bg-ink text-white', done: 'bg-pass text-white' }

export function SetupStep({ n, title, state = 'next', tag, children }: { n: number; title: string; state?: 'now' | 'done' | 'next'; tag?: ReactNode; children?: ReactNode }) {
  return <section className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-3 pb-[18px] last:pb-0 not-last:before:absolute not-last:before:top-8 not-last:before:bottom-1 not-last:before:left-[13.5px] not-last:before:w-px not-last:before:bg-mid">
    <span className={cn('grid size-7 place-items-center rounded-full font-mono text-[12px]/none font-semibold [&_svg]:size-3.5 [&_svg]:[stroke-width:2.2]', STEP_NUMBER[state])} aria-hidden="true">{state === 'done' ? SETUP_ICONS.check : n}</span>
    <div className="flex min-w-0 flex-col gap-2.5"><h3 className="mt-1 mb-0 flex flex-wrap items-center gap-2 text-sm font-semibold">{title}{tag && <Badge variant={state === 'done' ? 'tag-success' : 'tag'}>{tag}</Badge>}</h3>{children}</div>
  </section>
}

export function SetupFoot({ info, error, cancel, children }: { info: SetupInfo; error?: string; cancel: () => void; children: ReactNode }) {
  return <>
    {info.warn && <Alert variant="note-warning">{SETUP_ICONS.bolt}<span>{info.warn}</span></Alert>}
    <Alert variant="note">{SETUP_ICONS.shield}<span>{info.safe}</span>
      {info.details && <Collapsible className="data-open:basis-full">
        <CollapsibleTrigger className="block cursor-pointer border-0 bg-transparent p-0 text-left text-xs text-mute underline underline-offset-2">Details</CollapsibleTrigger>
        <CollapsibleContent><ul className="mt-2 mb-0 ml-[23px] flex flex-col gap-1 p-0 text-mute">{info.details.map((line) => <li key={line}>{line}</li>)}</ul></CollapsibleContent>
      </Collapsible>}
    </Alert>
    {error && <Alert variant="error-text" role="alert">{error}</Alert>}
    <div className="sticky bottom-0 flex items-center gap-2 border-t border-hair bg-card px-5 py-3.5">
      <span className="mr-auto inline-flex items-center gap-1.5 text-sm text-mute [&_svg]:size-[13px]">{SETUP_ICONS.clock}{info.eta}</span>
      <Button type="button" variant="secondary" onClick={cancel}>Cancel</Button>
      {children}
    </div>
  </>
}

export function SetupSubmit({ form = 'connect-main', brand, label, busy, pending, disabled = false, lock }: { form?: string; brand?: BrandName; label: string; busy: string; pending: boolean; disabled?: boolean; lock?: string }) {
  return <Locked reason={lock}><Button type="submit" form={form} variant="primary" className="gap-2" disabled={pending || disabled}>
    {brand && <span className="grid size-5 place-items-center overflow-hidden rounded-[5px] bg-white"><Mark name={brand} size={18} variant="bare" /></span>}{pending ? busy : label}
  </Button></Locked>
}

export function Choices({ name, options, value, className }: { name: string; options: [string, SetupIcon, string][]; value: string; className?: string }) {
  return <RadioGroup name={name} variant="segmented" className={className}>{options.map(([option, icon, label]) => <RadioGroupItem key={option} value={option} defaultChecked={option === value}>
    {SETUP_ICONS[icon]}<span>{label}</span>
  </RadioGroupItem>)}</RadioGroup>
}
