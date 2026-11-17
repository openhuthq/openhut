import { useState, type ReactNode } from 'react'
import type { IconSvgElement } from '@hugeicons/react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip } from '@/components/ui/tooltip'
import { I, TINY_ICON } from '@/components/kit'
import { cn } from '@/lib/utils'
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

export function ConfirmIcon({ label, icon, danger, question, action, busy, onConfirm }: { label: string; icon: IconSvgElement; danger?: boolean; question: string; action: string; busy: boolean; onConfirm: (done: () => void) => void }) {
  const [open, setOpen] = useState(false)
  return <Popover open={open} onOpenChange={setOpen}>
    <Tooltip label={label}><PopoverTrigger className={cn(TINY_ICON, danger && 'hover:text-fail')} aria-label={label}><I icon={icon} size={16} /></PopoverTrigger></Tooltip>
    <PopoverContent className="w-auto flex-row items-center gap-2 rounded-lg p-1.5 pl-3 text-[13px]" align="end">
      <span>{question}</span>
      <Button type="button" variant="secondary" size="xs" onClick={() => setOpen(false)}>Cancel</Button>
      <Button type="button" variant={danger ? 'destructive' : 'primary'} size="xs" disabled={busy} onClick={() => onConfirm(() => setOpen(false))}>{action}</Button>
    </PopoverContent>
  </Popover>
}
