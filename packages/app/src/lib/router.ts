import { useLayoutEffect, useSyncExternalStore } from 'react'

const MOVED = 'openhut:navigate'

export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, '', to)
  else history.pushState(null, '', to)
  dispatchEvent(new Event(MOVED))
}

export function usePath() {
  return useSyncExternalStore(subscribe, () => location.pathname)
}

export function useSearch() {
  return useSyncExternalStore(subscribe, () => location.search)
}

export function useOpen() {
  return new URLSearchParams(useSearch()).get('open')
}

export function open(name?: string) {
  navigate(name ? `${location.pathname}?open=${encodeURIComponent(name)}` : location.pathname, true)
}

export function Redirect({ to }: { to: string }) {
  useLayoutEffect(() => navigate(to, true), [to])
  return null
}

export function inAppPath({ href, target, download, here }: { href: string; target: string; download: boolean; here: string }): string | undefined {
  if (!href || target || download) return undefined
  const url = new URL(href, here)
  const now = new URL(here)
  if (url.protocol !== now.protocol || url.host !== now.host || url.pathname.startsWith('/api/')) return undefined
  if (url.hash && url.pathname === now.pathname && url.search === now.search) return undefined
  return `${url.pathname}${url.search}${url.hash}`
}

function subscribe(listener: () => void) {
  addEventListener('popstate', listener)
  addEventListener(MOVED, listener)
  return () => {
    removeEventListener('popstate', listener)
    removeEventListener(MOVED, listener)
  }
}

function follow(event: MouseEvent) {
  const link = event.target instanceof Element ? event.target.closest('a') : null
  if (!link || event.defaultPrevented || event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const to = inAppPath({ href: link.getAttribute('href') ?? '', target: link.target, download: link.hasAttribute('download'), here: location.href })
  if (!to) return
  event.preventDefault()
  navigate(to)
}

if (typeof document !== 'undefined') document.addEventListener('click', follow)
