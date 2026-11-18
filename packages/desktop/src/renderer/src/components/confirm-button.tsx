import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { IconSvgElement } from '@hugeicons/react'
import { Tooltip } from '@/components/ui/tooltip'
import { I, PILL, TINY_ICON } from '@/components/kit'
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
  const { confirming, setConfirming, box } = useConfirming()
  if (!confirming) return <Tooltip label={label}><Button type="button" variant="bare" className={cn(TINY_ICON, danger && 'hover:text-fail')} aria-label={label} onClick={() => setConfirming(true)}><I icon={icon} size={16} /></Button></Tooltip>
  return <div ref={box} role="group" aria-label={question} className="flex min-w-0 animate-grow items-center gap-1.5">
    <span className="min-w-0 truncate text-[12px] text-mute">{question}</span>
    <Button type="button" variant="secondary" className={PILL} autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
    <Button type="button" variant={danger ? 'destructive' : 'primary'} className={PILL} disabled={busy} onClick={() => onConfirm(() => setConfirming(false))}>{action}</Button>
  </div>
}

export function useConfirming() {
  const [confirming, setConfirming] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!confirming) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopImmediatePropagation()
      setConfirming(false)
    }
    const outside = (event: PointerEvent) => { if (!(event.target instanceof Node && box.current?.contains(event.target))) setConfirming(false) }
    window.addEventListener('keydown', escape, true)
    window.addEventListener('pointerdown', outside, true)
    return () => { window.removeEventListener('keydown', escape, true); window.removeEventListener('pointerdown', outside, true) }
  }, [confirming])
  return { confirming, setConfirming, box }
}
