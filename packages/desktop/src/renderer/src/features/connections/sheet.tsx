import type { ReactNode } from 'react'
import { Alert02Icon, CheckmarkCircle02Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import { FieldError } from '@/components/ui/field'
import { I } from '@/components/kit'
import { cn } from '@/lib/utils'

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-mute">{label}</span>{children}{error && <FieldError>{error}</FieldError>}</label>
}

export function Success({ children }: { children: string }) {
  return <div className="flex animate-grow items-center gap-2 rounded-lg bg-success-subtle px-3 py-2.5 text-[12.5px] font-medium text-success-foreground"><I icon={CheckmarkCircle02Icon} size={15} />{children}</div>
}

export function Warn({ children }: { children: string }) {
  return <div className="flex gap-2 rounded-lg border border-[color-mix(in_oklch,var(--color-amber)_35%,transparent)] bg-[color-mix(in_oklch,var(--color-amber)_7%,var(--card))] p-3 text-[13px]/[18px] text-body"><I icon={Alert02Icon} size={14} className="mt-0.5 shrink-0 text-amber" />{children}</div>
}

export function Lines({ title, lines, tone = 'mute' }: { title?: string; lines: string[]; tone?: 'mute' | 'success' }) {
  return <div className="flex flex-col gap-2">
    {title && <span className="text-[12px]/[16px] text-mute">{title}</span>}
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]/[18px] text-body">{lines.map((line) => <li key={line} className="flex gap-2"><I icon={Tick02Icon} size={12} className={cn('mt-[3px] shrink-0', tone === 'success' ? 'text-success-foreground' : 'text-mute')} />{line}</li>)}</ul>
  </div>
}
