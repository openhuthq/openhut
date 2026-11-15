import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Dialog({ labelledBy, className = 'dlg', onClosed, children }: { labelledBy: string; className?: string; onClosed: () => void; children: (close: () => void) => ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])
  const close = () => ref.current?.close()
  return createPortal(
    <dialog ref={ref} className={className} aria-labelledby={labelledBy} onClose={onClosed} onClick={(event) => { if (event.target === event.currentTarget) close() }}>{children(close)}</dialog>,
    document.body,
  )
}
