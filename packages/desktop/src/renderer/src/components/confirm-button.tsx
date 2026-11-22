import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { IconSvgElement } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { Tooltip } from '@/components/ui/tooltip'
import { I, PILL, TINY_ICON } from '@/components/kit'
import { PHONE, useMedia } from '@/lib/media'
import { cn } from '@/lib/utils'
import { AlertDialog } from '@/components/ui/alert-dialog'
import { Button, type ButtonVariants } from '@/components/ui/button'
import { DialogFoot, DialogHead } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

type Confirmation = { question: string; detail: string; action: string; list?: string[]; typed?: string; onConfirm: () => unknown }

export function ConfirmButton({ variant = 'danger', size, label, disabled, className, children, ...confirmation }: Confirmation & ButtonVariants & {
  label?: string
  className?: string
  disabled?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return <>
    <Button type="button" variant={variant} size={size} className={className} title={label} aria-label={label} disabled={disabled} onClick={() => setOpen(true)}>{children}</Button>
    <ConfirmDialog open={open} onOpenChange={setOpen} {...confirmation} />
  </>
}

export function ConfirmDialog({ open, onOpenChange, question, detail, action, list, typed, onConfirm }: Confirmation & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (open) return
    setText('')
    setError(undefined)
  }, [open])
  const confirm = () => {
    const done = onConfirm()
    if (!(done instanceof Promise)) return onOpenChange(false)
    setBusy(true)
    setError(undefined)
    done.then(() => onOpenChange(false), (err: unknown) => setError(err instanceof Error ? err.message : String(err))).finally(() => setBusy(false))
  }
  return <AlertDialog open={open} onOpenChange={onOpenChange}>
    <DialogHead title={question} subtitle={detail} />
    {list && <ul className="m-0 flex list-none flex-col gap-2 px-5 pb-4 text-[13px]/[18px] text-ink">{list.map((item) => <li key={item} className="flex items-center gap-2"><I icon={Cancel01Icon} size={14} className="shrink-0 text-fail" />{item}</li>)}</ul>}
    {typed && <label className="flex flex-col gap-1.5 px-5 pb-4 text-[13px]/[18px] text-body"><span>Type <span className="font-medium text-ink">{typed}</span> to confirm</span><Input value={text} onChange={(event) => setText(event.target.value)} autoComplete="off" spellCheck={false} autoFocus /></label>}
    {error && <p role="alert" className="m-0 px-5 pb-4 text-[13px]/[18px] text-fail">{error}</p>}
    <DialogFoot>
      <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button type="button" variant="destructive" className="gap-2" disabled={busy || (Boolean(typed) && text.trim().toLowerCase() !== typed)} onClick={confirm}>{busy && <Spinner />}{action}</Button>
    </DialogFoot>
  </AlertDialog>
}

export function ConfirmIcon({ label, icon, danger, question, action, busy, onConfirm }: { label: string; icon: IconSvgElement; danger?: boolean; question: string; action: string; busy: boolean; onConfirm: (done: () => void) => void }) {
  const { confirming, setConfirming, box } = useConfirming()
  const phone = useMedia(PHONE)
  if (phone) return <ConfirmButton variant="bare" size="icon-sm" className={cn(TINY_ICON, danger && 'text-fail')} label={label} question={question} detail="" action={action} onConfirm={() => onConfirm(() => {})}><I icon={icon} size={16} /></ConfirmButton>
  if (!confirming) return <Tooltip label={label}><Button type="button" variant="bare" className={cn(TINY_ICON, danger && 'text-fail')} aria-label={label} onClick={() => setConfirming(true)}><I icon={icon} size={16} /></Button></Tooltip>
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
