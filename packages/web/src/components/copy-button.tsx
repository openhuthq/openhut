import { ICONS } from '@/components/icons'
import { copyText } from '@/lib/clipboard'

export function CopyButton({ text, label }: { text: string; label: string }) {
  return <button type="button" className="btn sec sm" onClick={() => copyText(text)}>{ICONS.copy}{label}</button>
}
