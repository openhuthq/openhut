import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { Hut } from '@/components/hut'
import { ICONS } from '@/components/icons'
import { DRAG, I } from '@/components/kit'
import { OWN_TITLE_BAR } from '@/lib/platform'
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

export function Step({ title, line, happy = false, back, backLabel = 'Back', action, link, children }: { title: string; line?: ReactNode; happy?: boolean; back?: () => void; backLabel?: string; action?: ReactNode; link?: ReactNode; children?: ReactNode }) {
  return <div className="@container flex w-full flex-col items-center gap-6 text-center">
    <FrameHut happy={happy} />
    <div key={`t-${title}`} className="flex max-w-full animate-[fadein_.4s_ease-out] flex-col items-center gap-2 motion-reduce:animate-none">
      <h1 className="m-0 text-[42px]/[50px] font-bold tracking-[-.035em] text-balance @max-[600px]:text-[32px]/[40px]">{title}</h1>
      {line && <p className="m-0 flex max-w-[440px] items-center gap-1.5 text-[16px]/[24px] text-balance text-body">{line}</p>}
    </div>
    <div key={`b-${title}`} className="flex w-full animate-[fadein_.4s_.08s_ease-out_backwards] flex-col items-center gap-3 text-[13px]/[18px] empty:hidden motion-reduce:animate-none">{children}</div>
    <div className="flex flex-col items-center gap-3 text-[14px] empty:hidden">
      {action}
      {(back || link) && <div className="flex items-center justify-center gap-4">
        {back && <Button type="button" variant="text" className="font-normal text-mute" data-back onClick={back}>{backLabel}</Button>}
        {link}
      </div>}
    </div>
  </div>
}

function FrameHut({ happy }: { happy: boolean }) {
  return <span className="relative isolate size-[112px] shrink-0">
    <i className={cn('absolute -inset-[26%] -z-10 rounded-full bg-[radial-gradient(circle,#f7c94866,transparent_64%)] transition-[opacity,scale] duration-700 ease-out', happy ? 'scale-100 opacity-100' : 'scale-60 opacity-0')} />
    <Hut mood={happy ? 'happy' : undefined} className="still size-full" />
    <i className={cn('absolute right-1 bottom-2 grid size-[30px] place-items-center rounded-full border-[3px] border-canvas bg-pass text-white transition-[opacity,scale] duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]', happy ? 'scale-100 opacity-100' : 'scale-40 opacity-0')}><I icon={Tick02Icon} size={15} className="[&_path]:stroke-[2.6]" /></i>
  </span>
}

export const BIG = 'h-[46px] w-[300px] justify-center gap-2 rounded-lg text-[15px]'

export function Stage({ children }: { children: ReactNode }) {
  return <Window><div className="w-full max-w-[560px] py-6">{children}</div></Window>
}

export function Window({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-ink">
    <div className={cn('flex h-[52px] shrink-0 items-center justify-center text-[13px] font-semibold text-mute', DRAG)}>{OWN_TITLE_BAR && document.title}</div>
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe gap-4 overflow-y-auto px-8 pb-12 text-center">{children}</div>
  </div>
}
