import { useSyncExternalStore, type ReactNode } from 'react'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { I } from '@/components/kit'

const SHOWN_MS = 6000
const MAX_SHOWN = 3
export const GREEN = '#12a150'
export const AMBER = '#d97706'
export const RED = 'oklch(52% 0.19 25)'

type Notice = { key: number; lead: ReactNode; title: string; note?: ReactNode }
let notices: Notice[] = []
let next = 0
const listeners = new Set<() => void>()

export function Toast({ lead, title, note, children, alert }: { lead: ReactNode; title: string; note?: ReactNode; children?: ReactNode; alert?: boolean }) {
  return <div role={alert ? 'alert' : 'status'} className="flex w-full items-center gap-3 rounded-[18px] border border-hair bg-card p-2.5 pr-3 shadow-[0_8px_24px_oklch(0%_0_0/.10)] animate-grow">
    <span className="grid size-9 shrink-0 place-items-center">{lead}</span>
    <span className="grid min-w-0 flex-1 gap-px text-[13px]"><span className="font-semibold">{title}</span>{note && <span className="truncate text-mute">{note}</span>}</span>
    {children}
  </div>
}

export function Tinted({ icon, hue }: { icon: Parameters<typeof I>[0]['icon']; hue: string }) {
  return <span style={{ color: hue }}><I icon={icon} size={20} /></span>
}

export function notify({ lead = <Tinted icon={Tick02Icon} hue={GREEN} />, title, note }: { lead?: ReactNode; title: string; note?: ReactNode }): void {
  const notice = { key: next++, lead, title, note }
  notices = [...notices, notice].slice(-MAX_SHOWN)
  emit()
  setTimeout(() => {
    notices = notices.filter((each) => each !== notice)
    emit()
  }, SHOWN_MS)
}

export function Toasts({ children }: { children?: ReactNode }) {
  const shown = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => notices)
  return <div className="pointer-events-none fixed top-14 right-[294px] z-50 flex w-[380px] max-w-[calc(100%-32px)] flex-col gap-2 phone:top-[calc(10px+env(safe-area-inset-top,0px))] phone:right-4 *:pointer-events-auto">
    {children}
    {shown.map((each) => <Toast key={each.key} lead={each.lead} title={each.title} note={each.note} />)}
  </div>
}

function emit(): void {
  for (const listener of listeners) listener()
}
