import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { Hut } from '@/components/hut'
import { ICONS } from '@/components/icons'
import { DRAG, I } from '@/components/kit'
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
  return <div className="@container grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[24px_120px_26px_50px_32px_minmax(0,1fr)_46px_48px] justify-items-center px-8 text-center">
    <FrameHut happy={happy} />
    <h1 key={`t-${title}`} className="row-start-4 m-0 animate-[fadein_.4s_ease-out] max-w-full truncate text-[42px]/[50px] font-bold tracking-[-.035em] @max-[600px]:text-[32px] motion-reduce:animate-none">{title}</h1>
    <p key={`l-${title}`} className="row-start-5 m-0 flex max-w-full animate-[fadein_.4s_ease-out] items-center gap-1.5 truncate text-[16px]/[32px] text-body motion-reduce:animate-none">{line}</p>
    <div key={`b-${title}`} className="no-scrollbar row-start-6 flex w-full animate-[fadein_.4s_.08s_ease-out_backwards] flex-col items-center justify-center-safe gap-3 overflow-y-auto py-4 text-[13px]/[18px] motion-reduce:animate-none">{children}</div>
    <div className="row-start-7 flex items-center justify-center gap-2">{action}</div>
    <div className="row-start-8 flex items-center justify-center gap-4 text-[14px]">
      {back && <Button type="button" variant="text" className="font-normal text-mute" data-back onClick={back}>{backLabel}</Button>}
      {link}
    </div>
  </div>
}

function FrameHut({ happy }: { happy: boolean }) {
  return <span className="relative isolate row-start-2 size-[120px]">
    <i className={cn('absolute -inset-[26%] -z-10 rounded-full bg-[radial-gradient(circle,#f7c94866,transparent_64%)] transition-[opacity,scale] duration-700 ease-out', happy ? 'scale-100 opacity-100' : 'scale-60 opacity-0')} />
    <Hut mood={happy ? 'happy' : undefined} className="still size-full" />
    <i className={cn('absolute right-1 bottom-2 grid size-[30px] place-items-center rounded-full border-[3px] border-canvas bg-pass text-white transition-[opacity,scale] duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]', happy ? 'scale-100 opacity-100' : 'scale-40 opacity-0')}><I icon={Tick02Icon} size={15} className="[&_path]:stroke-[2.6]" /></i>
  </span>
}

export const PRIMARY = 'h-[46px] w-[300px] justify-center gap-2 rounded-[10px] text-[15px] shadow-[0_1px_2px_rgb(11_11_12/.25),0_8px_18px_-10px_rgb(11_11_12/.7)]'

export function Stage({ children }: { children: ReactNode }) {
  return <Window><div className="flex h-[min(600px,100%)] w-full max-w-[640px] flex-col">{children}</div></Window>
}

export function Window({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-ink">
    <div className={cn('flex h-[52px] shrink-0 items-center justify-center text-[13px] font-semibold text-mute', DRAG)}>OpenHut</div>
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-12 text-center">{children}</div>
  </div>
}
