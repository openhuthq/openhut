import { useEffect, useState } from 'react'

export function moreBelow({ scrollHeight, scrollTop, clientHeight }: { scrollHeight: number; scrollTop: number; clientHeight: number }): boolean {
  return scrollHeight - scrollTop - clientHeight > 1
}

export function useMoreBelow<T extends HTMLElement>() {
  const [box, ref] = useState<T | null>(null)
  const [more, setMore] = useState(false)
  useEffect(() => {
    if (!box) return
    const check = () => setMore(moreBelow(box))
    check()
    box.addEventListener('scroll', check, { passive: true })
    const resized = new ResizeObserver(check)
    resized.observe(box)
    const changed = new MutationObserver(check)
    changed.observe(box, { childList: true, subtree: true })
    return () => {
      box.removeEventListener('scroll', check)
      resized.disconnect()
      changed.disconnect()
    }
  }, [box])
  return { ref, more }
}

export function stillPinned({ pinned, scrollHeight, scrollTop, clientHeight, lastTop }: { pinned: boolean; scrollHeight: number; scrollTop: number; clientHeight: number; lastTop: number }): boolean {
  if (scrollHeight - scrollTop - clientHeight < 80) return true
  return pinned && scrollTop >= lastTop
}
