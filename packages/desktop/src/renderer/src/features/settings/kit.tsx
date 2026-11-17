import type { ReactNode } from 'react'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { ArrowRight01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/copy-button'
import { Creature } from '@/components/creature'
import { I, PILL } from '@/components/kit'
import { home } from '@/features/settings/desktop'
import { cn } from '@/lib/utils'

export function Intro({ children }: { children: ReactNode }) {
  return <p className="m-0 -mb-5 px-2.5 text-[13px]/[18px] text-mute">{children}</p>
}

const ROW = 'flex min-h-12 w-full items-center gap-4 rounded-lg border-0 bg-transparent px-2.5 py-[9px] text-left text-ink no-underline'

export function Row({ icon, title, note, href, onClick, onToggle, expanded, controls, disabled, children }: { icon: ReactNode; title: ReactNode; note?: ReactNode; href?: string; onClick?: () => void; onToggle?: () => void; expanded?: boolean; controls?: string; disabled?: boolean; children?: ReactNode }) {
  const body = <>
    <span className="grid size-6 shrink-0 place-items-center">{icon}</span>
    <span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-[13px]/[18px]">{title}</span>{note && <span className="text-[12px]/[16px] text-mute">{note}</span>}</span>
    {children && <span className="flex shrink-0 items-center gap-2 text-[13px]">{children}</span>}
  </>
  if (onToggle) return <div role="button" tabIndex={0} aria-expanded={expanded} aria-controls={controls} className={cn(ROW, 'cursor-default hover:bg-hover')} onClick={onToggle} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle() } }}>{body}</div>
  if (href) return <a href={href} className={cn(ROW, 'hover:bg-hover')}>{body}</a>
  if (onClick) return <Button type="button" variant="bare" disabled={disabled} className={cn(ROW, 'not-disabled:hover:bg-hover')} onClick={onClick}>{body}</Button>
  return <div className={ROW}>{body}</div>
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-0.5">{children}</div>
}

export function Chevron({ open }: { open?: boolean }) {
  return <I icon={ArrowRight01Icon} size={16} className={cn('text-mute transition-transform duration-200', open && 'rotate-90')} />
}

export function Expand({ open, id, children }: { open: boolean; id: string; children: ReactNode }) {
  return <div id={id} className={cn('grid transition-[grid-template-rows] duration-200 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}><div className="min-h-0 overflow-hidden" inert={!open}>{children}</div></div>
}

export function Command({ text }: { text: string }) {
  return <div className="flex items-center gap-2 rounded-lg bg-tint py-1.5 pr-1.5 pl-3">
    <code className="no-scrollbar fade-r min-w-0 flex-1 overflow-x-auto py-1 pr-6 font-mono text-[12.5px]/[1.6] whitespace-pre text-ink">{home(text)}</code>
    <CopyButton text={text} label="Copy" className={PILL} />
  </div>
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <div className="text-[18px] font-semibold">{children}</div>
}

const MARKS = { done: <I icon={Tick02Icon} size={12} />, now: <i className="size-2 animate-pulse rounded-full bg-ink" />, failed: <i className="size-2 rounded-full bg-fail" />, next: null }

export function Progress({ rows }: { rows: [string, string, 'done' | 'now' | 'next' | 'failed'][] }) {
  return <div className="flex flex-col gap-3">{rows.map(([label, note, state]) => <div key={label} className={cn('flex items-center gap-2.5 text-sm', state === 'next' && 'text-mute-2', state === 'now' && 'font-medium', state === 'failed' && 'font-medium text-fail')}>
    <span className={cn('grid size-5 place-items-center rounded-full', state === 'done' ? 'bg-success-subtle text-success-foreground' : 'bg-soft')}>{MARKS[state]}</span>
    {label}<span className={cn('ml-auto text-right font-mono text-xs', state === 'failed' ? 'text-fail' : 'text-mute')}>{note}</span>
  </div>)}</div>
}

export function Check({ checked, disabled, onChange, children }: { checked: boolean; disabled?: boolean; onChange: () => void; children: ReactNode }) {
  return <label className={cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5', disabled ? 'opacity-50' : 'cursor-pointer hover:bg-tint')}>
    <CheckboxPrimitive.Root checked={checked} disabled={disabled} onCheckedChange={onChange} className="grid size-4 shrink-0 place-items-center rounded-[4px] border border-mid bg-card p-0 data-checked:border-ink data-checked:bg-ink">
      <CheckboxPrimitive.Indicator className="flex text-white"><I icon={Tick02Icon} size={11} /></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
    {children}
  </label>
}

export function AgentCheck({ agent, checked, disabled, onChange }: { agent: { id: string; name: string; instructions: string }; checked: boolean; disabled?: boolean; onChange: () => void }) {
  return <Check checked={checked} disabled={disabled} onChange={onChange}>
    <Creature id={agent.id} about={agent.instructions} size={28} />
    <span className="grid min-w-0 leading-tight"><span className="text-[13px] font-medium">{agent.name}</span><span className="truncate text-[11.5px] text-mute">{agent.instructions.split('\n')[0] || 'No instructions yet'}</span></span>
  </Check>
}
