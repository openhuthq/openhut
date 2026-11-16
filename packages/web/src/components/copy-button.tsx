import { useState } from 'react'
import { Button, type ButtonVariants } from '@/components/ui/button'
import { ICONS } from '@/components/icons'
import { copyText } from '@/lib/clipboard'

export function CopyButton({ text, label, variant = 'secondary', size = 'sm' }: { text: string; label: string } & ButtonVariants) {
  const [copied, setCopied] = useState(false)
  const copy = () => copyText(text).then((ok) => {
    if (!ok) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  })
  return (
    <Button type="button" variant={variant} size={size} onClick={copy}>
      {copied ? <span className="inline-flex w-3 animate-[copy-pop_.2s_ease-out] justify-center">{ICONS.check}</span> : ICONS.copy}
      {label}
    </Button>
  )
}
