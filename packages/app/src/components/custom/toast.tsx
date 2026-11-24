import { useEffect, type ReactNode } from 'react'
import { toast } from 'sonner'
import { I } from '@/components/kit'

export const GREEN = '#12a150'
export const AMBER = '#d97706'
export const RED = 'oklch(52% 0.19 25)'

type Action = { label: string; onClick: () => void }
type Notice = { lead?: ReactNode; title: string; note?: ReactNode; action?: Action; cancel?: Action }

export function Tinted({ icon, hue }: { icon: Parameters<typeof I>[0]['icon']; hue: string }) {
  return <span className="flex" style={{ color: hue }}><I icon={icon} size={20} /></span>
}

export function notify({ lead, title, note, action, onDismiss }: Notice & { onDismiss?: () => void }): void {
  const duration = action ? 20_000 : 6000
  toast.success(title, { icon: lead, description: note, action, duration: onDismiss ? Infinity : duration, closeButton: Boolean(onDismiss), onDismiss })
}

export function useStickyToast({ id, notice, onDismiss }: { id: string; notice: Notice | null; onDismiss?: () => void }): void {
  useEffect(() => {
    if (!notice) return
    toast.info(notice.title, { id, icon: notice.lead, description: notice.note, action: notice.action, cancel: notice.cancel, duration: Infinity, onDismiss })
  })
  const shown = Boolean(notice)
  useEffect(() => {
    if (!shown) return
    return () => { toast.dismiss(id) }
  }, [id, shown])
}
