import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

export function Toaster(props: ToasterProps) {
  return <Sonner theme="system" position="bottom-right" className="toaster group" style={{ '--normal-bg': 'var(--card)', '--normal-text': 'var(--ink)', '--normal-border': 'var(--hair)', '--border-radius': 'var(--radius)' } as CSSProperties} toastOptions={{ classNames: { toast: '!flex-wrap !items-start !gap-x-2.5 [&_[data-button]~[data-button]]:!ml-1.5', content: '!grow !basis-[calc(100%-44px)]', description: '!text-mute', actionButton: '!mt-1 !h-7 !rounded-full !bg-ink !px-3 !text-card', cancelButton: '!mt-1 !h-7 !rounded-full !bg-soft !px-3 !text-body' } }} {...props} />
}
