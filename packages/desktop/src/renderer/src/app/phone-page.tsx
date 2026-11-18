import { createContext, useContext, useEffect, useRef, type PointerEvent, type ReactNode } from 'react'
import { slide } from '@/lib/media'
import { navigate } from '@/lib/router'

const Back = createContext(() => navigate('/'))

export function usePhoneBack() {
  return useContext(Back)
}

export function PhonePage({ children }: { children: ReactNode }) {
  const page = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; at: number } | null>(null)
  useEffect(() => {
    const root = document.documentElement
    root.dataset.pushed = ''
    return () => { delete root.dataset.pushed }
  }, [])
  const back = () => {
    delete document.documentElement.dataset.pushed
    if (page.current) slide({ element: page.current, to: '100% 0', done: () => navigate('/') })
    else navigate('/')
  }
  const drop = () => {
    delete document.documentElement.dataset.dragging
    document.documentElement.style.removeProperty('--drag')
  }
  const move = (event: PointerEvent) => {
    if (!drag.current || !page.current) return
    page.current.style.transition = 'none'
    const moved = Math.max(0, event.clientX - drag.current.x)
    page.current.style.translate = `${moved}px 0`
    document.documentElement.dataset.dragging = ''
    document.documentElement.style.setProperty('--drag', String(Math.min(1, moved / page.current.offsetWidth)))
  }
  const end = (event: PointerEvent) => {
    if (!drag.current || !page.current) return
    const moved = event.clientX - drag.current.x
    const fast = moved / Math.max(1, event.timeStamp - drag.current.at) > 0.5
    drag.current = null
    drop()
    if (moved > page.current.offsetWidth / 3 || (fast && moved > 30)) back()
    else slide({ element: page.current, to: '0 0' })
  }
  return <Back value={back}>
    <div ref={page} className="rides-keyboard fixed inset-0 z-10 flex animate-[pushin_.42s_var(--ease-spring)] bg-card pt-[env(safe-area-inset-top)] pb-[calc(var(--safe-bottom)+var(--kb))] shadow-[-12px_0_32px_oklch(0%_0_0/.1)]">
      {children}
      <div aria-hidden className="absolute inset-y-0 left-0 z-30 w-7 touch-none"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          drag.current = { x: event.clientX, at: event.timeStamp }
        }}
        onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    </div>
  </Back>
}
