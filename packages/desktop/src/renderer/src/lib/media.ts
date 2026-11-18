import { useSyncExternalStore } from 'react'

export const PHONE = '(max-width: 640px)'
export const TOUCH = '(pointer: coarse)'

export function useMedia(query: string) {
  return useSyncExternalStore((listener) => {
    const list = matchMedia(query)
    list.addEventListener('change', listener)
    return () => list.removeEventListener('change', listener)
  }, () => matchMedia(query).matches)
}

const EASE = 'translate .34s cubic-bezier(.22, 1, .36, 1)'

export function slide({ element, to, done }: { element: HTMLElement; to: string; done?: () => void }) {
  element.style.transition = EASE
  element.style.translate = to
  if (!done) return
  const finished = (event: Event) => {
    if (event.target !== element) return
    element.removeEventListener('transitionend', finished)
    done()
  }
  element.addEventListener('transitionend', finished)
}
