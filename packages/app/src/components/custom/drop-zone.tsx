import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function DropZone({ onText, children, className }: { onText: (text: string) => void; children: (hot: boolean) => ReactNode; className?: string }) {
  const [hot, setHot] = useState(false)
  const depth = useRef(0)
  const picker = useRef<HTMLInputElement>(null)
  const latest = useRef(onText)
  latest.current = onText
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]')) return
      const pasted = event.clipboardData?.getData('text')
      if (!pasted) return
      event.preventDefault()
      latest.current(pasted)
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [])
  const take = async (data: DataTransfer | null) => {
    const file = data?.files[0]
    const dropped = file ? await file.text() : data?.getData('text')
    if (dropped) onText(dropped)
  }
  const enter = (event: DragEvent) => {
    event.preventDefault()
    depth.current += 1
    setHot(true)
  }
  const leave = () => {
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setHot(false)
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    depth.current = 0
    setHot(false)
    void take(event.dataTransfer)
  }
  return <>
    <button type="button" data-hot={hot || undefined} className={cn('flex w-full flex-col items-center gap-1.5 rounded-xl border-[1.5px] border-dashed border-mid bg-card px-6 py-6 text-[14px] text-body transition-[background-color,border-color] duration-200 hover:border-ink data-hot:border-pass data-hot:bg-success-subtle data-hot:text-ink', className)} onClick={() => picker.current?.click()} onDragEnter={enter} onDragOver={(event) => event.preventDefault()} onDragLeave={leave} onDrop={drop}>
      {children(hot)}
    </button>
    <input ref={picker} type="file" accept=".txt,text/plain" className="hidden" onChange={(event) => void event.target.files?.[0]?.text().then(onText)} />
  </>
}
