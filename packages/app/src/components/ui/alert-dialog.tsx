import type { ReactNode } from 'react'
import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog'
import { backdropClass, popupClass } from '@/components/ui/dialog'

export function AlertDialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  return <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop forceRender className={backdropClass('confirm')} />
      <AlertDialogPrimitive.Popup data-size="confirm" className={popupClass('confirm')}>{children}</AlertDialogPrimitive.Popup>
    </AlertDialogPrimitive.Portal>
  </AlertDialogPrimitive.Root>
}
