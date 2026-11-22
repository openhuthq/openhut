import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { ArrowLeft01Icon, ArrowRight01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { DialogTitle } from '@/components/ui/dialog'
import { Meter } from '@/components/ui/meter'
import { CopyButton } from '@/components/copy-button'
import { Face } from '@/features/agents/face'
import { I, ICON_BUTTON, PILL } from '@/components/kit'
import { home } from '@/features/settings/home'
import { open } from '@/lib/router'
import { cn } from '@/lib/utils'

export function Intro({ children }: { children: ReactNode }) {
  return <p className="m-0 -mb-[30px] px-2.5 text-[13px]/[18px] text-mute">{children}</p>
}

export function ListNote({ children }: { children: ReactNode }) {
  return <p className="m-0 -mt-1 pr-2.5 pl-[50px] text-[12px]/[16px] text-mute phone:pl-2.5">{children}</p>
}

const ROW = 'flex min-h-12 w-full items-start gap-4 rounded-lg! border-0 bg-transparent px-2.5 py-[9px] text-left text-ink no-underline'

const TOP = 'flex max-h-[34px] shrink-0 items-center self-stretch'

export function Row({ icon, title, note, href, onClick, disabled, children }: { icon: ReactNode; title: ReactNode; note?: ReactNode; href?: string; onClick?: () => void; disabled?: boolean; children?: ReactNode }) {
  const body = <>
    <span className={cn(TOP, 'w-6 justify-center')}>{icon}</span>
    <span className="flex min-w-0 flex-1 flex-col self-center"><span className="truncate text-[13px]/[18px]">{title}</span>{note && <span className="text-[12px]/[16px] text-mute">{note}</span>}</span>
    {children && <span className={cn(TOP, 'gap-2 text-[13px]')}>{children}</span>}
  </>
  if (href) return <a href={href} className={cn(ROW, 'hover:bg-hover')}>{body}</a>
  if (onClick) return <Button type="button" variant="bare" disabled={disabled} className={cn(ROW, 'not-disabled:hover:bg-hover')} onClick={onClick}>{body}</Button>
  return <div className={ROW}>{body}</div>
}

export function Rows({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-0.5 empty:hidden phone:rounded-2xl phone:bg-card phone:p-1">{children}</div>
}

export function SubPage({ title, back, children }: { title: string; back: string; children: ReactNode }) {
  return <div className="flex flex-col gap-4">
    <div className="-mt-1 flex items-center gap-1"><Button type="button" data-back variant="bare" className={ICON_BUTTON} aria-label="Back" title="Back" onClick={() => open(back)}><I icon={ArrowLeft01Icon} size={16} /></Button><span className="text-[14px] font-medium">{title}</span></div>
    {children}
  </div>
}

export function Chevron() {
  return <I icon={ArrowRight01Icon} size={16} className="-mr-[5px] text-mute" />
}

export function Command({ text }: { text: string }) {
  return <div className="flex items-center gap-2 rounded-lg bg-tint py-1.5 pr-1.5 pl-3">
    <code className="no-scrollbar fade-r min-w-0 flex-1 overflow-x-auto py-1 pr-6 font-mono text-[12px]/[1.6] whitespace-pre text-ink">{home(text)}</code>
    <CopyButton text={text} label="Copy" variant="ghost" className={PILL} />
  </div>
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <DialogTitle className="text-[15px]/[22px] font-medium">{children}</DialogTitle>
}

const MARKS = { done: <I icon={Tick02Icon} size={12} />, now: <i className="size-2 animate-pulse rounded-full bg-ink" />, failed: <i className="size-2 rounded-full bg-fail" />, next: null }

export function Progress({ rows }: { rows: [string, string, 'done' | 'now' | 'next' | 'failed', number?][] }) {
  return <div className="flex flex-col gap-3">{rows.map(([label, note, state, fraction]) => <div key={label} className="flex flex-col gap-2">
    <div className={cn('flex items-center gap-2.5 text-sm', state === 'next' && 'text-mute-2', state === 'now' && 'font-medium', state === 'failed' && 'font-medium text-fail')}>
      <span className={cn('grid size-5 place-items-center rounded-full', state === 'done' ? 'bg-success-subtle text-success-foreground' : 'bg-soft')}>{MARKS[state]}</span>
      {label}<span className={cn('ml-auto whitespace-nowrap text-right font-mono text-xs tabular-nums', state === 'failed' ? 'text-fail' : 'text-mute')}>{note}</span>
    </div>
    {state === 'now' && fraction !== undefined && <Meter className="ml-[30px]" value={Math.round(fraction * 100)} aria-label={label} />}
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
    <Face agent={agent} size={28} />
    <span className="grid min-w-0 leading-tight"><span className="text-[13px] font-medium">{agent.name}</span><span className="truncate text-[11.5px] text-mute">{agent.instructions.split('\n')[0] || 'No instructions yet'}</span></span>
  </Check>
}

export { useConfirming } from '@/components/confirm-button'
