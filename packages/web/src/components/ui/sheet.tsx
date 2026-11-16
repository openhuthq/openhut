import type { ReactNode } from 'react'
import { Dialog } from '@/components/ui/dialog'

export function Sheet({ dismissable, onClose, children }: { dismissable?: boolean; onClose: () => void; children: ReactNode }) {
  return <Dialog size="sheet" dismissable={dismissable} onClose={onClose}>{children}</Dialog>
}
