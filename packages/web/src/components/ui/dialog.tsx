import type { ComponentProps, ReactNode } from 'react'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { Button } from '@/components/ui/button'
import { ICONS } from '@/components/icons'
import { cn } from '@/lib/utils'

const popupVariants = cva('group/dialog fixed inset-0 z-50 overflow-auto border-0 bg-card p-0 text-ink', {
  variants: {
    size: {
      default: 'm-auto h-fit w-[min(880px,calc(100vw-32px))] rounded-xl shadow-dialog animate-grow',
      narrow: 'm-auto h-fit w-[min(560px,calc(100vw-32px))] rounded-xl shadow-dialog animate-grow',
      confirm: 'm-auto h-fit w-[min(440px,calc(100vw-32px))] rounded-xl shadow-dialog animate-grow',
      setup: 'm-auto h-fit w-[min(600px,calc(100vw-32px))] rounded-2xl shadow-dialog animate-grow',
      sheet: 'my-0 mr-0 ml-auto h-dvh max-h-dvh w-[min(560px,100vw)] rounded-none border-l border-hair shadow-sheet animate-sheetin',
    },
  },
  defaultVariants: { size: 'default' },
})

export type DialogSize = NonNullable<VariantProps<typeof popupVariants>['size']>

export function backdropClass(size: DialogSize) {
  return cn('fixed inset-0 z-50', size === 'sheet' ? 'bg-[oklch(0%_0_0/.1)] backdrop-blur-[4px]' : 'bg-[oklch(0%_0_0/.32)] backdrop-blur-[3px]')
}

export function popupClass(size: DialogSize, className?: string) {
  return cn(popupVariants({ size }), className)
}

export function Dialog({ size = 'default', dismissable = true, onClose, className, children }: { size?: DialogSize; dismissable?: boolean; onClose: () => void; className?: string; children: ReactNode }) {
  return <DialogPrimitive.Root open disablePointerDismissal={!dismissable} onOpenChange={(open, details) => { if (!open && (dismissable || details.reason !== 'escape-key')) onClose() }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className={backdropClass(size)} />
      <DialogPrimitive.Popup data-size={size} className={popupClass(size, className)}>{children}</DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>
}

const frameVariants = cva('flex flex-col', {
  variants: { height: { fixed: 'h-[min(80vh,780px)]', auto: 'max-h-[min(85vh,780px)]', full: 'h-full' } },
  defaultVariants: { height: 'fixed' },
})

export function DialogFrame({ height, className, ...props }: ComponentProps<'form'> & VariantProps<typeof frameVariants>) {
  return <form className={cn(frameVariants({ height }), className)} {...props} />
}

export function DialogBox({ height, className, ...props }: ComponentProps<'div'> & VariantProps<typeof frameVariants>) {
  return <div className={cn(frameVariants({ height }), className)} {...props} />
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex items-start gap-3 border-b border-hair px-5 py-[18px] group-data-[size=confirm]/dialog:border-b-0 group-data-[size=confirm]/dialog:pb-1.5 group-data-[size=sheet]/dialog:border-b-0 group-data-[size=sheet]/dialog:pb-1', className)} {...props} />
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('m-0 text-base font-medium', className)} {...props} />
}

export function DialogDescription({ className, ...props }: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('mt-1 mb-0 text-mute', className)} {...props} />
}

export function DialogHead({ title, subtitle, onClose }: { title: string; subtitle?: ReactNode; onClose?: () => void }) {
  return <DialogHeader>
    <div className="min-w-0 flex-1"><DialogTitle>{title}</DialogTitle>{subtitle && <DialogDescription>{subtitle}</DialogDescription>}</div>
    {onClose && <Button type="button" size="icon-sm" onClick={onClose} aria-label="Close" title="Close">{ICONS.x}</Button>}
  </DialogHeader>
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-body" className={cn('flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5 group-data-[size=sheet]/dialog:[scrollbar-gutter:stable]', className)} {...props} />
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn('flex items-center justify-between gap-3 border-t border-hair px-5 py-3 group-data-[size=confirm]/dialog:border-t-0 group-data-[size=sheet]/dialog:overflow-hidden group-data-[size=sheet]/dialog:border-t-0 group-data-[size=sheet]/dialog:[scrollbar-gutter:stable]', className)} {...props} />
}

export function DialogFoot({ error, start, children }: { error?: string; start?: ReactNode; children: ReactNode }) {
  return <DialogFooter>
    {error ? <p data-error className="m-0 min-w-0 flex-1 rounded-md bg-[color-mix(in_oklch,var(--fail)_12%,transparent)] px-3 py-2 text-ink" role="alert">{error}</p> : <span>{start}</span>}
    <div className="flex gap-2">{children}</div>
  </DialogFooter>
}
