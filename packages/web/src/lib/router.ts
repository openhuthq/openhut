import { useLayoutEffect, useSyncExternalStore } from 'react'

export function navigate(to: string, replace = false) {
  navigation.navigate(to, { history: replace ? 'replace' : 'push' })
}

export function usePath() {
  return useSyncExternalStore(subscribe, () => location.pathname)
}

export function Redirect({ to }: { to: string }) {
  useLayoutEffect(() => navigate(to, true), [to])
  return null
}

function subscribe(listener: () => void) {
  navigation.addEventListener('currententrychange', listener)
  return () => navigation.removeEventListener('currententrychange', listener)
}

function inApp(event: NavigateEvent) {
  if (event.navigationType !== 'push' && event.navigationType !== 'replace') return false
  return event.canIntercept && !event.hashChange && event.downloadRequest === null && !event.formData && !new URL(event.destination.url).pathname.startsWith('/api/')
}

navigation.addEventListener('navigate', (event) => {
  if (inApp(event)) event.intercept({ focusReset: 'manual', scroll: 'manual' })
})
