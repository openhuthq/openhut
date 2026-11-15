import { useId, useRef, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { DialogFoot } from '@/components/dialog-foot'
import { DialogHead } from '@/components/dialog-head'

type Confirmation = { question: string; detail: string; action: string; onConfirm: () => void }

export function ConfirmButton({ className, label, disabled, children, ...confirmation }: Confirmation & {
  className: string
  label?: string
  disabled?: boolean
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  return <>
    <button type="button" className={className} title={label} aria-label={label} disabled={disabled} onClick={() => ref.current?.showModal()}>{children}</button>
    <ConfirmDialog dialogRef={ref} {...confirmation} />
  </>
}

export function ConfirmDialog({ dialogRef, question, detail, action, onConfirm }: Confirmation & { dialogRef: RefObject<HTMLDialogElement | null> }) {
  const headingId = useId()
  const close = () => dialogRef.current?.close()
  return createPortal(<dialog ref={dialogRef} className="dlg confirm" aria-labelledby={headingId} onClick={(event) => { if (event.target === event.currentTarget) close() }}>
    <DialogHead id={headingId} title={question} subtitle={detail} />
    <DialogFoot>
      <button type="button" className="btn sec" onClick={close}>Cancel</button>
      <button type="button" className="btn primary danger" onClick={() => { close(); onConfirm() }}>{action}</button>
    </DialogFoot>
  </dialog>, document.body)
}
