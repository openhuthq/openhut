import { createContext, useContext, type FormEvent, type ReactNode } from 'react'

import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { ArrowLeft01Icon, Cancel01Icon, Clock01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Dialog, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Glyph } from '@/components/glyph'
import type { BrandName } from '@/components/brand-icons'
import { cn } from '@/lib/utils'

const InWindow = createContext(false)
const FLAT = '[&_[data-slot=item-group]]:flex [&_[data-slot=item-group]]:flex-col [&_[data-slot=item-group]]:gap-2 [&_[data-slot=item-group]]:border-0 [&_[data-slot=item-group]]:bg-transparent [&_[data-slot=item-group]]:shadow-none [&_[data-slot=item-group]>*]:border-0 [&_[data-slot=item]]:px-0 [&_[data-slot=item-title]]:text-[13px] [&_[data-slot=item-title]]:font-normal [&_[data-slot=item-description]]:text-[12px] [&_[data-slot=button]]:rounded-full'

export const GLASS = 'bg-sidebar'
export const HOVER = 'hover:bg-hover'
export const ROW = 'flex h-8 w-full items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 text-left text-[13px] font-normal whitespace-nowrap text-ink no-underline hover:bg-hover'
export const ROW_VALUE = 'ml-auto inline-flex min-w-0 items-center gap-1.5 text-[13px] text-ink'
export const PICKED = 'bg-picked hover:bg-picked'
export const SURFACE = 'border border-solid border-hair bg-card text-ink no-underline hover:bg-[color-mix(in_oklch,var(--card),black_3.5%)]'
export const PILL = 'h-[26px] rounded-full px-2.5 text-[12px] font-normal'
export const TINY_ICON = 'grid size-7 shrink-0 place-items-center rounded-md border-0 bg-transparent p-0 text-ink hover:bg-hover disabled:opacity-50'
export const ICON_BUTTON = 'grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent p-0 text-body no-underline shadow-none outline-offset-0 hover:bg-hover hover:text-ink'
export const DRAG = '[-webkit-app-region:drag] select-none [&_a,&_button,&_input]:[-webkit-app-region:no-drag]'
export const HINT = 'm-0 text-[12px]/[16px] text-mute [&_b]:font-medium [&_b]:text-body [&_code]:font-mono [&_code]:text-[11.5px] [&_code]:text-ink'

export function I({ icon, size = 16, className }: { icon: IconSvgElement; size?: number; className?: string }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.6} className={cn('shrink-0', className)} aria-hidden="true" />
}

const TONE = {
  on: 'bg-pass',
  wait: 'animate-[blinkdot_1s_infinite] bg-amber',
  bad: 'bg-fail',
  off: 'bg-mute-2',
}

export type Tone = keyof typeof TONE

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 text-[13px] text-ink"><i className={cn('size-1.5 rounded-full', TONE[tone])} />{children}</span>
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const inWindow = useContext(InWindow)
  return <div className="flex flex-col gap-1.5"><div className={cn('flex items-center', inWindow ? 'px-2.5 text-[12px]/[16px] text-mute' : 'text-[12px]/[16px] text-mute')}>{title}<span className="ml-auto">{action}</span></div>{children}</div>
}

export function MenuCard({ title, align = 'start', children }: { title: string; align?: 'start' | 'end'; children: ReactNode }) {
  return <DropdownMenuContent align={align} className="flex min-w-(--anchor-width) flex-col gap-0.5 rounded-lg p-1.5 shadow-pop">
    <div className="px-2 pt-1 pb-1.5 text-[12px] text-mute">{title}</div>{children}
  </DropdownMenuContent>
}

export function Choice({ icon, name, note, selected = false, disabled, onClick }: { icon: ReactNode; name: string; note?: string; selected?: boolean; disabled?: boolean; onClick?: () => void }) {
  return <DropdownMenuItem disabled={disabled} onClick={onClick} className={cn('h-auto gap-2.5 rounded-lg px-2 py-1.5 data-highlighted:bg-tint [&_svg]:text-ink', selected && 'bg-tint')}>
    <span className="grid size-7 place-items-center rounded-lg bg-soft text-ink">{icon}</span>
    <span className="grid flex-1 leading-tight"><span className="text-[13px] font-medium">{name}</span>{note && <span className="text-[11.5px] text-mute">{note}</span>}</span>
    {selected && <I icon={Tick02Icon} size={14} />}
  </DropdownMenuItem>
}

export const SPLIT_DIALOG = 'h-[min(720px,calc(100vh-48px))] w-[min(1080px,calc(100vw-32px))] gap-0 overflow-hidden p-0'

export function DialogCard({ onClose, dismissable, className, children }: { onClose: () => void; dismissable?: boolean; className?: string; children: ReactNode }) {
  return <Dialog size="narrow" dismissable={dismissable} onClose={onClose} className={cn('flex flex-col gap-4 rounded-xl p-5', className)}>{children}</Dialog>
}

export function AppWindow({ label, nav, onClose, onEscape, children }: { label: string; nav?: ReactNode; onClose: () => void; onEscape?: () => void; children: ReactNode }) {
  return <Dialog size="window" label={label} onClose={onClose} onEscape={onEscape}>
    <InWindow value>
      {nav}
      <section aria-label={label} className={cn('relative flex min-w-0 flex-1 flex-col text-[13px]/[18px]', FLAT)}>
        <Button type="button" size="icon" aria-label="Close" title="Close (Esc)" className="absolute top-2.5 right-2.5 z-10 rounded-full" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
        {children}
      </section>
    </InWindow>
  </Dialog>
}

export function Frame({ face, title, subtitle, action, foot, onClose, children }: { face: ReactNode; title: string; subtitle: ReactNode; action?: ReactNode; foot?: ReactNode; onClose: () => void; children: ReactNode }) {
  return <DialogCard onClose={onClose} className="h-[min(600px,calc(100vh-48px))] w-[560px] gap-0 overflow-hidden p-0">
    <div className="flex items-start gap-3 px-5 pt-5 pb-4">
      {face}
      <div className="grid min-w-0 flex-1 gap-1"><DialogTitle className="text-[15px]/[22px] font-medium">{title}</DialogTitle><p className="m-0 text-[13px]/[18px] text-body">{subtitle}</p></div>
      {action}
      <Button type="button" size="icon-sm" aria-label="Close" tabIndex={-1} className="-mt-1 -mr-1" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>
    </div>
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-5 pb-5">{children}</div>
    {foot && <div className="flex items-center gap-2 border-t border-hair px-5 py-3">{foot}</div>}
  </DialogCard>
}

export function SetupSheet({ brand, title, blurb, eta, safe, error, foot, onSubmit, onClose, children }: {
  brand: BrandName; title: string; blurb: string; eta?: string; safe?: string; error?: string; foot: ReactNode
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void; onClose: () => void; children?: ReactNode
}) {
  const inWindow = useContext(InWindow)
  const body = <>
    <div className={cn('flex items-start gap-3.5 px-5 pt-5 pb-4', inWindow && 'items-center px-8 pt-[26px] pr-14')}>
      {inWindow && <Button type="button" size="icon-sm" aria-label="Back" title="All connections" className="-ml-2" onClick={onClose}><I icon={ArrowLeft01Icon} size={16} /></Button>}
      <Glyph name={brand} size={inWindow ? 30 : 28} />
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex items-center gap-2"><DialogTitle className={inWindow ? 'text-[17px]/[24px] font-medium' : 'text-[15px]/[22px] font-medium'}>{title}</DialogTitle>{eta && <span className="inline-flex items-center gap-1 text-[11.5px] text-mute-2"><I icon={Clock01Icon} size={12} />{eta}</span>}</div>
        <p className="m-0 text-[13px]/[18px] text-body">{blurb}</p>
      </div>
      {!inWindow && <Button type="button" size="icon-sm" aria-label="Close" tabIndex={-1} className="-mt-1 -mr-1" onClick={onClose}><I icon={Cancel01Icon} size={15} /></Button>}
    </div>
    {children && <div className={cn('flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-5 pt-1 pb-5', inWindow && 'no-scrollbar fade-b px-8 pb-6')}>{children}</div>}
    {error && <p role="alert" className="m-0 border-t border-hair bg-[color-mix(in_oklch,var(--fail)_8%,transparent)] px-5 py-2.5 text-[13px] text-ink">{error}</p>}
    <div className={cn('flex items-center gap-3 border-t-[0.5px] border-hair px-5 py-3 [&_button]:text-[13px]', inWindow && 'px-8')}>
      {safe && <span className="min-w-0 flex-1 text-[12px]/[16px] text-mute">{safe}</span>}
      <span className="ml-auto flex shrink-0 gap-2">{foot}</span>
    </div>
  </>
  const content = onSubmit ? <form className="flex min-h-0 flex-1 flex-col" onSubmit={onSubmit}>{body}</form> : body
  if (inWindow) return <div className="flex min-h-0 flex-1 flex-col">{content}</div>
  return <DialogCard onClose={onClose} className="max-h-[min(640px,calc(100vh-48px))] w-[540px] gap-0 overflow-hidden p-0">{content}</DialogCard>
}

const DOT = { done: 'bg-success-subtle text-success-foreground', now: 'bg-ink text-white', next: 'bg-soft text-mute-2' }

export function Step({ n, title, state = 'next', tag, children }: { n: number; title: string; state?: keyof typeof DOT; tag?: ReactNode; children?: ReactNode }) {
  return <div className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-3 gap-y-2.5">
    <span className={cn('grid size-[22px] place-items-center rounded-full text-[11px] font-semibold', DOT[state])}>{state === 'done' ? <I icon={Tick02Icon} size={12} /> : n}</span>
    <span className={cn('flex items-center gap-2 text-[13px]/[18px] font-medium', state === 'next' && 'text-mute-2')}>{title}{tag && <span className="text-[12px] font-normal text-mute">· {tag}</span>}</span>
    {children && <div className="col-start-2 flex flex-col gap-3">{children}</div>}
  </div>
}

export function Busy({ label }: { label: string }) {
  return <Button type="button" variant="primary" disabled><Spinner className="mt-0 border-white/30 border-t-white" />{label}</Button>
}

export function Dots() {
  return <span className="inline-flex gap-[3px]">{['', '[animation-delay:.16s]', '[animation-delay:.32s]'].map((delay) => <i key={delay} className={cn('size-[4px] animate-pulse rounded-full bg-ink', delay)} />)}</span>
}
