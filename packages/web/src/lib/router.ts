import { useLayoutEffect, useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()

export function navigate(to: string, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  listeners.forEach((listener) => listener())
}

export function usePath() {
  return useSyncExternalStore(subscribe, () => location.pathname)
}

export function Redirect({ to }: { to: string }) {
  useLayoutEffect(() => navigate(to, true), [to])
  return null
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    removeEventListener('popstate', listener)
  }
}

addEventListener('click', (event) => {
  if (!(event.target instanceof Element) || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const anchor = event.target.closest('a')
  if (!anchor || anchor.target || anchor.hasAttribute('download') || anchor.origin !== location.origin || anchor.pathname.startsWith('/api/')) return
  event.preventDefault()
  navigate(anchor.pathname + anchor.search + anchor.hash)
})
