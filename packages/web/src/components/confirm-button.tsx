import { useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DialogFoot } from '@/components/dialog-foot'
import { DialogHead } from '@/components/dialog-head'

export function ConfirmButton({ className, disabled, question, detail, action, onConfirm, children }: {
  className: string
  disabled?: boolean
  question: string
  detail: string
  action: string
  onConfirm: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  const close = () => ref.current?.close()
  return <>
    <button type="button" className={className} disabled={disabled} onClick={() => ref.current?.showModal()}>{children}</button>
    {createPortal(<dialog ref={ref} className="dlg confirm" aria-labelledby={headingId} onClick={(event) => { if (event.target === event.currentTarget) close() }}>
      <DialogHead id={headingId} title={question} subtitle={detail} />
      <DialogFoot>
        <button type="button" className="btn sec" onClick={close}>Cancel</button>
        <button type="button" className="btn danger" onClick={() => { close(); onConfirm() }}>{action}</button>
      </DialogFoot>
    </dialog>, document.body)}
  </>
}
