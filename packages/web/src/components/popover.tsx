import { useEffect, useRef, type ReactNode } from 'react'
import { navigate } from '@/lib/router'

export function Popover({ open, href, back, buttonClass, button, children }: { open: boolean; href: string; back: string; buttonClass: string; button: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (!open) return
    ref.current?.querySelector<HTMLElement>('input,select')?.focus()
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') navigate(back) }
    const closeOutside = (event: MouseEvent) => { if (ref.current && !event.composedPath().includes(ref.current)) navigate(back) }
    addEventListener('keydown', closeOnEscape)
    addEventListener('click', closeOutside)
    return () => {
      removeEventListener('keydown', closeOnEscape)
      removeEventListener('click', closeOutside)
    }
  }, [open, back])
  return <details ref={ref} className="pop" open={open}>
    <summary className={buttonClass} onClick={(event) => { event.preventDefault(); navigate(open ? back : href) }}>{button}</summary>
    {children}
  </details>
}
