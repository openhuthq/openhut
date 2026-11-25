import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Dialog } from '@/components/ui/dialog'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { Hut } from '@/components/hut'
import { ICONS } from '@/components/icons'
import { I } from '@/components/kit'
import type { Mood } from '@/lib/hut'
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

/** The entry flow's one layout: a centered 360px column (art, title, line, body, action) and quiet links at the bottom edge. */
export function EntryScreen({ title, line, happy = false, mood, art, action, waiting, foot, children }: { title: string; line?: ReactNode; happy?: boolean; mood?: Mood; art?: ReactNode; action?: ReactNode; waiting?: ReactNode; foot?: ReactNode; children?: ReactNode }) {
  return <div className="flex min-h-0 w-full flex-1 flex-col text-center text-ink">
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe overflow-y-auto px-6 py-6">
      <div className="flex w-[360px] max-w-full flex-col items-center">
        {art === undefined ? <FrameHut happy={happy} mood={mood} /> : art}
        <div key={`t-${title}`} className="flex max-w-full animate-[fadein_.4s_ease-out] flex-col items-center motion-reduce:animate-none">
          <h1 className="m-0 text-[30px]/[36px] font-bold tracking-[-.03em] text-balance phone:text-[28px]/[34px]">{title}</h1>
          {line && <p className="m-0 mt-2 max-w-[320px] text-[15px]/[22px] text-balance text-body">{line}</p>}
        </div>
        <div key={`b-${title}`} className="mt-8 flex w-full animate-[fadein_.4s_.08s_ease-out_backwards] flex-col items-center gap-3 text-[13px]/[18px] empty:hidden motion-reduce:animate-none">{children}</div>
        {(action || waiting) && <div className="mt-8 flex w-full flex-col items-center gap-3.5 text-[14px]">
          {waiting ? <WaitPill>{waiting}</WaitPill> : action}
        </div>}
      </div>
    </div>
    {foot && <div className="flex shrink-0 flex-wrap items-center justify-center gap-x-[22px] gap-y-1 px-6 pt-[18px] pb-7 text-[13px] text-mute">{foot}</div>}
  </div>
}

/** What a waiting screen shows where its button would be. */
export function WaitPill({ children }: { children: ReactNode }) {
  return <span role="status" className="inline-flex items-center gap-2 rounded-full bg-soft px-3.5 py-[7px] text-[13.5px] text-body"><Spinner className="mt-0" />{children}</span>
}

function FrameHut({ happy, mood }: { happy: boolean; mood?: Mood }) {
  return <span className="relative isolate mb-7 size-[88px] shrink-0 phone:size-20">
    <i className={cn('absolute -inset-[26%] -z-10 rounded-full bg-[radial-gradient(circle,#f7c94866,transparent_64%)] transition-[opacity,scale] duration-700 ease-out', happy ? 'scale-100 opacity-100' : 'scale-60 opacity-0')} />
    <Hut mood={happy ? 'happy' : mood} className="still size-full" />
    <i className={cn('absolute -right-0.5 bottom-0.5 grid size-[28px] place-items-center rounded-full border-[3px] border-canvas bg-pass text-white transition-[opacity,scale] duration-300 ease-[cubic-bezier(.34,1.56,.64,1)]', happy ? 'scale-100 opacity-100' : 'scale-40 opacity-0')}><I icon={Tick02Icon} size={14} className="[&_path]:stroke-[2.6]" /></i>
  </span>
}

/** The one black button: 44px, the column's full width. */
export const BIG = 'h-11 w-full justify-center gap-2 rounded-[10px] text-[15px]'
/** A quiet footer link. */
export const QUIET = 'h-auto font-normal text-[13px] text-mute'
/** A link beside the button that is a real second way. */
export const INK = 'h-auto text-[14px] font-medium text-ink'

export function Stage({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-ink">
    <TitleBar />
    {children}
  </div>
}

function TitleBar() {
  return <div className="h-[52px] shrink-0" />
}

export function Window({ children }: { children: ReactNode }) {
  return <div className="flex h-dvh flex-col bg-canvas pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-ink">
    <TitleBar />
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center-safe gap-4 overflow-y-auto px-8 pb-12 text-center">{children}</div>
  </div>
}
