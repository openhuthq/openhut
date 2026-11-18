import { useSyncExternalStore } from 'react'

export const PHONE = '(max-width: 639px)'

export function useMedia(query: string) {
  return useSyncExternalStore((listener) => {
    const list = matchMedia(query)
    list.addEventListener('change', listener)
    return () => list.removeEventListener('change', listener)
  }, () => matchMedia(query).matches)
}
