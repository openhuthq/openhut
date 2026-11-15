import { useState } from 'react'
import { ICONS } from '@/components/icons'
import { copyText } from '@/lib/clipboard'

export function CopyButton({ text, label, className = 'btn sec sm' }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => copyText(text).then((ok) => {
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  })
  return (
    <button type="button" className={className} onClick={copy}>
      {copied ? <span className="copied">{ICONS.check}</span> : ICONS.copy}
      {label}
    </button>
  )
}
