import { ICONS } from '@/components/icons'
import { copyText } from '@/lib/clipboard'

export function CopyButton({ text, label = text }: { text: string; label?: string }) {
  return <button type="button" className="copy" onClick={() => copyText(text)}>{ICONS.copy}{label}</button>
}
