import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ICONS } from '@/components/icons'
import { cn } from '@/lib/utils'

export function Guide({ label, at, of, onClose, children }: { label: string; at: number; of: number; onClose: () => void; children: ReactNode }) {
  return <Dialog size="narrow" label={label} onClose={onClose}>
    <div className="flex h-[min(560px,calc(100dvh-48px))] flex-col">
      <div className="relative flex h-12 shrink-0 items-center justify-center">
        {of > 1 && <span role="img" aria-label={`Step ${at + 1} of ${of}`} className="flex gap-1.5">{Array.from({ length: of }, (_, index) => <i key={index} className={cn('h-1.5 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none', index === at ? 'w-5 bg-ink' : 'w-1.5 bg-mid')} />)}</span>}
        <Button type="button" size="icon-sm" className="absolute top-2.5 right-3" onClick={onClose} aria-label="Close" title="Close">{ICONS.x}</Button>
      </div>
      {children}
    </div>
  </Dialog>
}

export function Step({ art, title, line, back, action, children }: { art: ReactNode; title: ReactNode; line?: ReactNode; back?: () => void; action?: ReactNode; children?: ReactNode }) {
  return <div className="flex min-h-0 flex-1 animate-[stepin_.28s_ease-out] flex-col motion-reduce:animate-none">
    <div className="flex h-[120px] shrink-0 items-end justify-center">{art}</div>
    <div className="flex shrink-0 flex-col items-center gap-1.5 px-8 pt-4 text-center">
      <span className="text-[18px]/[1.3] font-semibold tracking-[-.01em]">{title}</span>
      {line && <p className="m-0 max-w-[440px] text-[13.5px]/[20px] text-body">{line}</p>}
    </div>
    <div className="no-scrollbar flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-8 pt-5 pb-3 text-center text-[13px]/[18px]">{children}</div>
    <div className="flex h-16 shrink-0 items-center justify-between border-t border-hair px-5">
      {back ? <Button type="button" variant="secondary" data-back onClick={back}>Back</Button> : <span />}
      {action}
    </div>
  </div>
}

export const PRIMARY = 'h-9 min-w-[128px] justify-center px-4'
