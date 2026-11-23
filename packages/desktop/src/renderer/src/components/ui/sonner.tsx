import type { CSSProperties } from 'react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'

export function Toaster(props: ToasterProps) {
  return <Sonner theme="system" position="bottom-right" className="toaster group" style={{ '--normal-bg': 'var(--card)', '--normal-text': 'var(--ink)', '--normal-border': 'var(--hair)', '--border-radius': 'var(--radius)' } as CSSProperties} toastOptions={{ classNames: { description: '!text-mute', actionButton: '!rounded-full !bg-ink !text-card', cancelButton: '!rounded-full !bg-soft !text-body' } }} {...props} />
}
