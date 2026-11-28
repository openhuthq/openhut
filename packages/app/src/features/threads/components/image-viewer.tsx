import { useState } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { Cancel01Icon, Download04Icon } from '@hugeicons/core-free-icons'
import { I } from '@/components/kit'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ROUND = 'size-9 justify-center rounded-full bg-white/10 px-0 text-white not-disabled:hover:bg-white/20'

export function ImageViewer({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  return <DialogPrimitive.Root open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-[oklch(0%_0_0/.88)]" />
      <DialogPrimitive.Popup aria-label={name} className="fixed inset-0 z-50 flex items-center justify-center p-16 outline-none phone:px-3" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
        <img src={src} alt={name} className="max-h-full max-w-full rounded-lg object-contain" />
        <div className="absolute top-3 right-3 flex gap-2">
          <a href={src} download={name} target="_blank" rel="noreferrer" className={cn(buttonVariants(), ROUND)} aria-label={`Download ${name}`} title="Download"><I icon={Download04Icon} size={16} /></a>
          <Button type="button" className={ROUND} onClick={onClose} aria-label="Close" title="Close"><I icon={Cancel01Icon} size={16} /></Button>
        </div>
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

export function ZoomImage({ src, name, className }: { src: string; name: string; className?: string }) {
  const [open, setOpen] = useState(false)
  return <>
    <Button type="button" variant="bare" className={cn('block h-auto max-w-full cursor-zoom-in overflow-hidden rounded-lg p-0', className)} onClick={() => setOpen(true)} aria-label={`Open ${name}`}><img src={src} alt={name} className="block h-auto w-full" /></Button>
    {open && <ImageViewer src={src} name={name} onClose={() => setOpen(false)} />}
  </>
}
