import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Tick02Icon } from '@hugeicons/core-free-icons'
import { I, PILL } from '@/components/kit'
import { Button } from '@/components/ui/button'

const SHOWN_MS = 6000
const ACTION_SHOWN_MS = 20_000
const MAX_SHOWN = 3
export const GREEN = '#12a150'
export const AMBER = '#d97706'
export const RED = 'oklch(52% 0.19 25)'

type Action = { label: string; onClick: () => void }
type Notice = { key: number; lead: ReactNode; title: string; note?: ReactNode; action?: Action }
let notices: Notice[] = []
let next = 0
const listeners = new Set<() => void>()

export function Toast({ lead, title, note, children, alert }: { lead: ReactNode; title: string; note?: ReactNode; children?: ReactNode; alert?: boolean }) {
  return <div role={alert ? 'alert' : 'status'} className="flex w-full items-center gap-2.5 rounded-2xl border border-hair bg-card py-2 pr-2 pl-3 shadow-[0_6px_20px_oklch(0%_0_0/.12)] animate-grow">
    <span className="grid size-6 shrink-0 place-items-center">{lead}</span>
    <span className="grid min-w-0 flex-1 gap-px text-[13px]"><span className="line-clamp-2 font-medium">{title}</span>{note && <span className={typeof note === 'string' ? 'line-clamp-3 text-mute' : 'grid text-mute'}>{note}</span>}</span>
    {children}
  </div>
}

export function Tinted({ icon, hue }: { icon: Parameters<typeof I>[0]['icon']; hue: string }) {
  return <span style={{ color: hue }}><I icon={icon} size={20} /></span>
}

export function notify({ lead = <Tinted icon={Tick02Icon} hue={GREEN} />, title, note, action }: { lead?: ReactNode; title: string; note?: ReactNode; action?: Action }): void {
  const notice = { key: next++, lead, title, note, action }
  notices = [...notices, notice].slice(-MAX_SHOWN)
  emit()
  setTimeout(() => {
    notices = notices.filter((each) => each !== notice)
    emit()
  }, action ? ACTION_SHOWN_MS : SHOWN_MS)
}

export function Toasts({ children }: { children?: ReactNode }) {
  const shown = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener) } }, () => notices)
  return <div data-toasts className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-[360px] max-w-[calc(100%-32px)] flex-col-reverse gap-2 phone:top-[calc(10px+env(safe-area-inset-top,0px))] phone:bottom-auto phone:flex-col *:pointer-events-auto">
    {children}
    {shown.map((each) => <Toast key={each.key} lead={each.lead} title={each.title} note={each.note}>{each.action && <Button type="button" variant="secondary" className={PILL} onClick={each.action.onClick}>{each.action.label}</Button>}</Toast>)}
  </div>
}

export function InToasts({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<Element | null>(null)
  useEffect(() => setHost(document.querySelector('[data-toasts]')), [])
  return host ? createPortal(children, host) : null
}

function emit(): void {
  for (const listener of listeners) listener()
}
