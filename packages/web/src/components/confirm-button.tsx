import { useState, type ReactNode } from 'react'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { Button, type ButtonVariants } from '@/components/ui/button'
import { DialogFoot, DialogHead } from '@/components/ui/dialog'

type Confirmation = { question: string; detail: string; action: string; onConfirm: () => void }

export function ConfirmButton({ variant = 'danger', size, label, disabled, children, ...confirmation }: Confirmation & ButtonVariants & {
  label?: string
  disabled?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return <>
    <Button type="button" variant={variant} size={size} title={label} aria-label={label} disabled={disabled} onClick={() => setOpen(true)}>{children}</Button>
    <ConfirmDialog open={open} onOpenChange={setOpen} {...confirmation} />
  </>
}

export function ConfirmDialog({ open, onOpenChange, question, detail, action, onConfirm }: Confirmation & { open: boolean; onOpenChange: (open: boolean) => void }) {
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <DialogHead title={question} subtitle={detail} />
    <DialogFoot>
      <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button type="button" variant="destructive" onClick={() => { onOpenChange(false); onConfirm() }}>{action}</Button>
    </DialogFoot>
  </AlertDialog>
}
