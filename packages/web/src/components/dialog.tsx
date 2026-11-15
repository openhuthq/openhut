import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Dialog({ labelledBy, className = 'dlg', dismissable = true, onClosed, children }: { labelledBy: string; className?: string; dismissable?: boolean; onClosed: () => void; children: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  const close = () => ref.current?.close()
  return createPortal(
    <dialog ref={ref} className={className} aria-labelledby={labelledBy} onClose={onClosed} onCancel={(event) => { if (!dismissable) event.preventDefault() }} onClick={(event) => { if (dismissable && event.target === event.currentTarget) close() }}>{children(close)}</dialog>,
    document.body,
  )
}
